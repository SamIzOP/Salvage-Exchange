# Step 3 architecture

The browser is an ES-module client; FastAPI serves its built assets and JSON API from the same origin. It polls every two seconds. There is no external analytics, font service, CDN dependency, client-authoritative economics or browser-only multiplayer simulation.

## Economic source of truth

`simulation/economy.py` is reused unchanged, with `Rules.from_dict` loading `simulation/rules-v0.2.json`. The model's historical v0.1 defaults are never used by the live service. `server/game.py` handles orchestration, strict boundary conversion, purchases, privacy projections and previews. It delegates validation, scans, settlement, market updates and scoring to the frozen module. Simulator policies are never live players.

Each round draws independent hidden sector outcomes and commodity events with `SystemRandom`, then stores them before briefing. Scans reveal stored values. Tie-breaking also uses server randomness. No random seed is sent to clients.

## Phase machine

Lobby (host starts with 2–4) → briefing (all acknowledge) → planning (all lock) → atomic settlement → upgrade (all acknowledge) → next briefing. Round 6 settlement goes directly to finished.

Settlement performs resolution and market update in one transaction. The phase tracker and reveal explain their order; there are no artificial timed windows that could be interrupted mid-settlement. Plans are immutable after lock. Disconnected players keep their seats; there is deliberately no host override, bot replacement or timeout forfeiture.

## Persistence

SQLite uses WAL and `BEGIN IMMEDIATE`. Each action loads the current JSON snapshot, authenticates membership, validates phase and round, checks its receipt, mutates an in-memory snapshot, and commits the whole result. Exceptions roll back. Concurrent last locks serialize; only the transition that sees all locked plans resolves. Receipts survive restarts and reject an ID reused with different content. Up to 2,000 successful actions per player are retained per match.

`rooms` stores JSON; `members` maps credential digests to room and seat. No pickle or raw rejoin key is stored server-side. Database files contain hidden game data and must never be publicly served. Back up using SQLite's online backup API or stop the service before copying the database and WAL files together.

The intended deployment is one service on one host with a persistent local volume. Do not use a network filesystem or replicate SQLite files across hosts. Multi-host scaling requires a transactional database migration and distributed rate limiting.

## Identity and privacy

The browser creates a 256-bit random key with Web Crypto and stores it locally. The server stores its SHA-256 digest. A room code can join a new seat before launch but cannot impersonate an existing seat. Names are not credentials. Create/join with the same key is idempotent. The rejoin form restores the same corporation on another browser. There is no account/password or email recovery service; losing every copy loses access to that seat.

Authenticated projections explicitly list fields. Only the caller receives their scans, objective, detailed assets and current plan. Public standings use the last reveal and exclude objective bonuses until final standings. Completed-round plans, bids, outcomes and formula inputs are public. There is no raw-room API. Previews use only the caller's state/plan/scans, public prices/demand and adjustable rival-supply assumptions.

Keys travel in headers or POST bodies, never URLs. Use HTTPS in production. The server rejects extra fields, non-finite or oversized orders, oversized bodies and foreign browser origins. CSP blocks external/inline scripts, frames and third-party connections. Names are escaped. API responses are not cached. Per-IP request rates are bounded; production also needs edge rate, body and timeout limits.

## Browser consistency

Drafts are saved per room, seat and round. Sealed commands snapshot their payload and persist an owner-scoped pending receipt before transmission. Unknown transport failures can retry safely. Session-generation checks ignore old-session replies; increasing room versions prevent stale polls overwriting new command results. Refresh restores authoritative state and the saved key. All six score components appear in a sticky desktop panel and compact fixed mobile strip.

## API

| Method / path | Purpose |
|---|---|
| GET `/api/health` | Health and economy version |
| POST `/api/rooms` | Create with name and rejoin key |
| POST `/api/rooms/{code}/join` | Join with name and rejoin key |
| GET `/api/rooms/{code}` | Caller-specific state; bearer required |
| POST `/api/rooms/{code}/commands` | Intent, request ID, expected round/phase |
| POST `/api/rooms/{code}/preview` | Own plan, rival_factor 0–2 |

Commands: start, ready, scan, purchase, lock. Purchases: fuel, drone, repair, insurance, scanner, retire. There are no endpoints for setting prices, dice, balances or outcomes; sabotage, short selling and loans remain excluded.

## Verification scope

Implementation checks are not Step 4's full two-session browser test, separate-device verification or a production audit. See STEP3_BUILD_REPORT.md. No public deployment has been attempted.
