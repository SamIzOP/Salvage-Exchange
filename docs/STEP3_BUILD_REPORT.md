# Step 3 build report

Date: 25 October 2026 (America/New_York). Branch: `codex/multiplayer-build`.
Base: `e2b8ad12ac70de2d0828a122a49d1bad722a1dfa` on `codex/economy-simulation`.

## Implemented

- 2–4-player room-code lobbies, host start, six rounds, independent corporate objectives and same-key reconnect/rejoin.
- FastAPI API, SQLite WAL snapshots, transactional actions, strict schemas, hashed identity keys, persisted idempotency receipts and server-only random outcomes.
- Explicit private projections for active plans, bids, scans and objectives; previous-round reveal logs and final objective reveal.
- Briefing acknowledgement, simultaneous planning/locks, atomic extraction and market update, reveal/upgrades and final standings, including exact ties.
- Frozen v0.2 commodities, stocks, fees, capacity/reserves, access bids, hazards, fuel, drones, scans/scanners, repairs, insurance, depreciation, delivery contracts, objectives and protected emergency recovery.
- Estimated market preview with adjustable rival supply, own scan knowledge, shared/won/lost access scenarios, projected quotes, personal/total extraction, salvage values, cash/fuel reservations and contract opportunity costs.
- Commodity/company formula breakdowns, revenue/cost/profit, numerical rounding/clipping audit and six-component personal net worth. Responsive dark mission-control UI, phase tracker, help, tooltips, readiness/lock indicators, drafts and pending-action retry.
- Setup guide, pinned Python dependency lockfile, build script, `.env.example`, architecture and Dockerfile. No sabotage, shorts or loans.

## Verification performed

| Check | Result / scope |
|---|---|
| `python simulation/test_economy.py` | 32/32 pass; original economic invariants |
| `python -m unittest discover -s tests -v` | 16/16 pass; service, persistence, atomic rejection, private projection, receipt handling, concurrent locks, recovery, final transition, HTTP boundary, preview and replay consistency |
| `node --test tests/client.test.mjs` | 3/3 pass; stale response/session rejection and immutable pending payload |
| `node scripts/build.mjs` | Pass; ES-module syntax checks and static asset build |
| Dependency consistency (`pip check`) | Pass; no broken requirements |
| Frozen source comparison against base | No changes to `simulation/`, `ECONOMY.md`, `BALANCE_REPORT.md` or `PROJECT_BRIEF.md` |
| Saved replay fixtures | 2/3/4-player full offline results exactly match; all 18 market transitions and recorded plans checked |
| Local startup | Uvicorn starts successfully; `/api/health` returns economy 0.2 and `/` returns HTTP 200 |
| Browser smoke | One desktop browser: create local lobby, render briefing/planning, refresh into same corporation; screenshot saved. A service helper created/acknowledged a second test seat. No complete round/match or independent second browser was exercised. |
| Independent code review | Read-only reviewer inspected server/client against requirements. Findings fixed with regression coverage. |

The Windows sandbox prevented asyncio's loopback socket initialization; HTTP tests and startup ran with approved local socket access. The bundled Python venv initially lacked pip bootstrap; its bundled pip installed into the project venv. Neither issue required weakening application defenses.

## Issues fixed during implementation

- Last player's deployed allocation used integer keys before JSON persistence, failing strict wire conversion. Preserve canonical wire keys when sealing.
- Stale lock flags blocked upgrade purchases. Clear locks at the committed resolution boundary.
- Late polls could replace a newer resolution or another session. Added session-generation and monotonic-version checks.
- Editable drafts could mutate a pending lock retry. Deep-copy commands before transmission and persist owner-scoped receipts; drafts are seat-scoped.
- Extreme finite order numbers could overflow frozen-model arithmetic. Reject them at the wire schema before any mutation.
- Added numeric effective price bounds and explicit clipping flags to complete the market audit requirement.
- SQLite initialization now closes its connection explicitly, avoiding Windows file handles remaining open during restart tests.

## Decisions and remaining work

The application reuses the Python model instead of a separate JavaScript economy. Resolution and market update are atomic stages explained in the UI. SQLite requires a persistent single-host deployment; horizontal scaling needs a database migration. Rejoin keys are bearer credentials: no account recovery is provided. A disconnected player can hold up progress until they return; there is no host override or timeout forfeiture. Rooms have no automatic expiry or administration interface yet.

Step 4's complete six-round two-player browser test, mobile usability verification, full adversarial API/network audit and separate-device verification remain **unperformed**. The mobile layout and sticky score strip are implemented but not independently device-tested. Docker packaging is documented, not built or production-verified. Step 5 is not started, and there is no public URL. These limits are not implied successes from the offline simulator or service tests.

No frozen balance numbers were changed. The economy is not universally balanced: lone extractors strongly counter pure traders, pure trading is weak in two-player games, Logistics objectives and automatic two-scan purchases underperform with these bots, and bounded final-mark incentives remain. See BALANCE_REPORT.md for measured sample sizes and exact rates.

Stop after Step 3. Await “continue” before the dedicated test sprint; deployment needs its later authorization.
