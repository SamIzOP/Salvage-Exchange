# Browser checks

These scripts drive the real UI in Chromium through Playwright against a local server. They are not part of `npm test`, because Playwright is not a project dependency. Install it separately (`npm i -g playwright` and `npx playwright install chromium`), or use an environment that already provides it.

Start a disposable local server first. `fixture.py` writes rooms straight into this database, so never point it at real player data.

```sh
SALVAGE_DB=/tmp/sx-test.sqlite3 .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8000
```

Then, from the repository root, in a second shell:

```sh
node tests/browser/match.cjs /tmp/sx-shots
SX_DB=/tmp/sx-test.sqlite3 node tests/browser/states.cjs /tmp/sx-shots
SX_DB=/tmp/sx-test.sqlite3 node tests/browser/sweep.cjs /tmp/sx-shots
node tests/browser/four.cjs /tmp/sx-shots
node tests/browser/missions.cjs /tmp/sx-shots
SX_DB=/tmp/sx-test.sqlite3 node tests/browser/record.cjs /tmp/sx-shots
```

| Script | What it proves |
|---|---|
| `match.cjs` | A six-round match between two identities using only UI controls. One player is on a 1440px desktop; the other is on a 375px touch phone with reduced motion and joins through the copied invite link. It checks every reveal against the server record, the final standings, and the phone player's traffic for leaked rival plans. |
| `states.cjs` | Editing while a rival locks, refresh and rejoin, a slow lock, a lost response retried without a double charge, insufficient credits and fuel, a disabled drone, the recovery drone, keyboard-only planning, connection loss, a missing room, and scan privacy. |
| `sweep.cjs` | Every phase at 375, 390, 768, 1024 and 1440px, plus 1440px at 200% zoom. It checks horizontal overflow, text under 12px, touch targets under 44px on narrow layouts, and primary actions hidden behind the phone dock. |
| `four.cjs` | Four separate identities fill a room at mixed viewport sizes, a fifth is refused, and one round settles. |
| `missions.cjs` | Plays the four training missions through the real controls at 1440 desktop, 375 phone (reduced motion), 390 phone and 1024 keyboard-only. It includes a failed mission 1 and its retry, a wrong mission 3 prediction, mission 4's empty tank and retry, hints, the final debrief and free practice. Then it leaves practice and reopens a live room, checking that room's own key is used. At every stage it checks overflow, touch targets and phone panel size, and that practice makes no API requests. |
| `record.cjs` | Records the reveal sequence as a WebM video. |

To run the same checks against the Workers port, start `npm run worker:dev` (or `npx wrangler dev --var WRITE_LIMIT:100000 --var READ_LIMIT:1000000` for the fixture-heavy suites) and set `SX_BASE=http://127.0.0.1:8787 SX_FIXTURE=http`. HTTP fixtures can't force hidden values, so the low-fuel, disabled-drone and recovery checks are reported as skipped.

The server rate-limits writes per IP. `fixture.py` builds hard-to-reach states through `GameService` directly, so repeated runs stay under that limit. All interaction under test still goes through HTTP.
