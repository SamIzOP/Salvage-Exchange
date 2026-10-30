-- Same tables as server/store.py, plus presence so polling never rewrites room state.
CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS members (digest TEXT PRIMARY KEY, code TEXT NOT NULL, seat INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS presence (code TEXT NOT NULL, seat INTEGER NOT NULL, seen REAL NOT NULL, PRIMARY KEY (code, seat));
