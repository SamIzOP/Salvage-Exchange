# Running Salvage Exchange on ChatGPT Sites

ChatGPT Sites runs web apps on OpenAI-managed hosting. OpenAI's help centre says a site must fit the "supported Sites runtime", that some frameworks, databases and background services may not be supported, and that each site gets up to 10 GB of database storage. Third-party reports describe that runtime as Cloudflare Workers, with D1 for the database and R2 for files. OpenAI's own documentation doesn't name the runtime, so treat that part as reported, not confirmed. Python servers and long-running processes are not available.

The original server is a long-running Python process, so the repository now also contains a Workers + D1 server in `worker/`. It is a faithful port of `server/`; the browser client in `web/` is unchanged and served from the same Worker.

**Status.** Verified locally in Cloudflare's own Workers runtime (`wrangler` 4.156.0, runtime dated 2026-10-23) with a local D1 database. It has **not** been deployed to ChatGPT Sites or to Cloudflare from this repository, and nothing here has been tested on a real Sites account.

## What is in the port

| Python (`server/`) | Worker (`worker/src/`) |
|---|---|
| `simulation/economy.py` (frozen rules) | `economy.js`, a line-for-line port of the functions the server uses |
| `game.py` | `game.js`, the same commands, errors, projections, previews and settlement reports |
| `models.py` (pydantic) | `schema.js`, the same strict fields, types, bounds and defaults |
| `store.py` (SQLite with `BEGIN IMMEDIATE`) | `store.js` (D1). Each write is one atomic batch conditioned on the revision the writer read; a lost race is re-read and retried, so a round settles exactly once |
| `app.py` (FastAPI) | `index.js`, the same routes, statuses, error details, body limit, origin check and security headers |

Rooms use the same JSON format and tables. A room created by one implementation can be opened and continued by the other.

## Deploying

1. `npm install`, then `npm run build`. This writes the browser assets to `dist/`.
2. The host must provide:
   - a D1 database bound as `DB`, with `worker/migrations/0001_rooms.sql` applied (the Worker also creates missing tables on first use);
   - the static files in `dist/` bound as `ASSETS`;
   - `worker/src/index.js` as the entry point.

   `wrangler.jsonc` declares all of this.
3. **On ChatGPT Sites:** import this repository or project and point it at `wrangler.jsonc`. If Sites expects a different project layout, keep the same entry point and the two binding names. I couldn't check the exact import steps, because OpenAI's help pages weren't reachable from this environment.
4. **On plain Cloudflare Workers:** run `npx wrangler d1 create salvage-exchange`, put the returned ID into `wrangler.jsonc`, then `npm run worker:deploy`.

Optional variables:

| Variable | Default | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | the site's own origin | Comma-separated browser origins allowed to send writes |
| `ALLOWED_HOSTS` | any | Comma-separated hostnames; `*.example.com` is supported |
| `READ_LIMIT` / `WRITE_LIMIT` | 600 / 120 per minute per IP | Raise only for local testing |

Run it locally with `npm run worker:dev` (http://127.0.0.1:8787).

## Differences from the Python server

- **Rate limits are best effort.** They are counted per Worker isolate, not across the whole deployment. Use the host's edge rate limiting in production.
- **Presence lives in its own `presence` table.** Polling updates that table instead of rewriting the room, so heartbeats never force game commands to retry.
- **Allocation order.** JavaScript orders numeric object keys, so a hand-crafted plan listing drone IDs in descending order is stored in ascending order. That changes only the order of the public `allocations` list in the round log, never an outcome; the browser always sends ascending IDs.
- **Integer fields accept `1.0`.** JSON `1.0` reaches JavaScript as `1` and is accepted where pydantic would reject it. The economic result is identical.
- **Name matching.** Duplicate corporation names are compared with an upper-then-lower case fold, which approximates Python's `casefold()` for unusual scripts.
- **Busy rooms.** Under extreme write contention a command gives up after 8 retries with 503 "The server is busy. Try again." This never happened in testing.
- **Framing is blocked.** Like the Python server, the Worker sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`. If ChatGPT Sites previews pages inside a frame, the preview may stay blank; open the site in its own tab, or relax these headers deliberately in `worker/src/index.js`.

## Keeping the two implementations identical

The frozen economy now exists twice. Any rule change must be made in both `simulation/economy.py` and `worker/src/economy.js`; `npm run test:worker` fails if they disagree. The Python reference must run on Python 3.12 or newer: from 3.12, `sum()` over floats uses Neumaier compensated summation, the port reproduces that, and Python 3.11 rounds differently in the last bit.

## Verification

| Check | Result |
|---|---|
| `tests/worker/economy.test.mjs` | Randomized settlements, validations and purchases (6,500 against Python 3.13, 3,000 against 3.12) plus 4,000 summation lists per run: bit-identical. Four deliberate one-line bugs in the port were each caught |
| `tests/worker/server.test.mjs` | 76 distinct recorded multi-player games (about 25,800 calls, over 30 distinct error messages per run, about 1,200 settlements; 12 of the games against Python 3.12) with replayed hidden rolls: every projection and error identical |
| `tests/worker/boundary.mjs` | 39 edge-case HTTP requests to both servers (bad origin, oversized body, credentials, extra fields, forged commands, wrong methods, private files): identical status, detail and security headers |
| `tests/worker/concurrency.mjs` | 25 rooms on the Worker: racing joins got distinct seats; racing last locks plus a duplicate retry settled once and charged once |
| Browser checks on the Worker (`SX_BASE=http://127.0.0.1:8787`) | Six-round two-identity match passed with every reveal reconciled and no rival secrets in traffic; 8/8 runnable state checks (3 need `fixture.py` and were skipped); layout sweep 0 problems; four-crew room passed |
| Cross-implementation | The Worker settled a Python-created room, and Python continued it |
| `wrangler deploy --dry-run` | Bundles to 49 KB (14 KB gzipped) with `DB` and `ASSETS` bindings |

Not verified: a real ChatGPT Sites or Cloudflare deployment; production D1 latency and limits; behaviour under real multi-region traffic.
