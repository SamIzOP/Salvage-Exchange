// Room snapshots in D1. D1 offers atomic batches but no interactive transactions, so each
// write is conditioned on the revision the writer read; a lost race is retried by the service
// from a fresh read. This keeps settlement exactly-once when the last crews lock together.
// Tables match server/store.py so rooms stay readable by the Python reference implementation.

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS members (digest TEXT PRIMARY KEY, code TEXT NOT NULL, seat INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS presence (code TEXT NOT NULL, seat INTEGER NOT NULL, seen REAL NOT NULL, PRIMARY KEY (code, seat))',
];

const conflict = err => /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(String(err?.message ?? err));

export class D1Store {
  constructor(db) { this.db = db; this.ready = null; }

  init() {
    this.ready ??= this.db.batch(SCHEMA.map(sql => this.db.prepare(sql))).catch(err => { this.ready = null; throw err; });
    return this.ready;
  }

  async load(code) {
    await this.init();
    const row = await this.db.prepare('SELECT state FROM rooms WHERE code = ?1').bind(code).first();
    return row ? JSON.parse(row.state) : null;
  }

  async member(digest) {
    await this.init();
    return this.db.prepare('SELECT code, seat FROM members WHERE digest = ?1').bind(digest).first();
  }

  // False when the code or the key is already taken; the caller re-reads and decides.
  async create(room, digest) {
    await this.init();
    try {
      await this.db.batch([
        this.db.prepare('INSERT INTO rooms (code, state) VALUES (?1, ?2)').bind(room.code, JSON.stringify(room)),
        this.db.prepare('INSERT INTO members (digest, code, seat) VALUES (?1, ?2, 0)').bind(digest, room.code),
      ]);
      return true;
    } catch (err) { if (conflict(err)) return false; throw err; }
  }

  // Writes only if nobody else wrote since `previous`. A joining seat is recorded in the same
  // batch, and only when this write won (its new revision is the one now stored).
  async commit(code, previous, room, joining) {
    await this.init();
    const statements = [this.db.prepare("UPDATE rooms SET state = ?1 WHERE code = ?2 AND COALESCE(json_extract(state, '$.rev'), '') = ?3")
      .bind(JSON.stringify(room), code, previous)];
    if (joining) {
      statements.push(this.db.prepare("INSERT INTO members (digest, code, seat) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM rooms WHERE code = ?2 AND json_extract(state, '$.rev') = ?4)")
        .bind(joining.digest, code, joining.seat, room.rev));
    }
    try {
      const [update] = await this.db.batch(statements);
      return update.meta.changes === 1;
    } catch (err) { if (conflict(err)) return false; throw err; }
  }

  // Presence is kept apart from the room so polling never rewrites the game state.
  async touch(code, seat, seen) {
    await this.init();
    await this.db.prepare('INSERT INTO presence (code, seat, seen) VALUES (?1, ?2, ?3) ON CONFLICT(code, seat) DO UPDATE SET seen = excluded.seen')
      .bind(code, seat, seen).run();
  }

  async presence(code) {
    await this.init();
    const {results} = await this.db.prepare('SELECT seat, seen FROM presence WHERE code = ?1').bind(code).all();
    return Object.fromEntries(results.map(row => [row.seat, row.seen]));
  }
}
