// The subset of Cloudflare's D1 API used by worker/src/store.js, backed by node:sqlite, so the
// Worker's store and SQL run unchanged in Node tests. batch() is atomic, as in D1.
import {DatabaseSync} from 'node:sqlite';

class Statement {
  constructor(db, sql, params = []) { Object.assign(this, {db, sql, params}); }
  bind(...params) { return new Statement(this.db, this.sql, params); }
  async first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return {results: this.db.prepare(this.sql).all(...this.params)}; }
  async run() { return this.exec(); }
  exec() { const r = this.db.prepare(this.sql).run(...this.params); return {success: true, meta: {changes: Number(r.changes)}}; }
}

export class D1 {
  constructor(path = ':memory:') { this.db = new DatabaseSync(path); }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => s.exec());
      this.db.exec('COMMIT');
      return results;
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
}
