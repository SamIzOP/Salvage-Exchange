"""Transactional JSON snapshots; never deserialize executable objects."""
import json
import sqlite3
from contextlib import contextmanager, closing
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, isolation_level=None)) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS members (digest TEXT PRIMARY KEY, code TEXT NOT NULL, seat INTEGER NOT NULL)')

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def load(db, code):
        row = db.execute('SELECT state FROM rooms WHERE code=?', (code,)).fetchone()
        return json.loads(row[0]) if row else None

    @staticmethod
    def save(db, room):
        db.execute('INSERT INTO rooms VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET state=excluded.state',
                   (room['code'], json.dumps(room, allow_nan=False, separators=(',', ':'))))
