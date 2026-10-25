# Step 3 implementation plan

Source: PROJECT_BRIEF.md, ECONOMY.md, BALANCE_REPORT.md and frozen rules-v0.2.json.
User authorizes implementation decisions, commit and push; full browser match and deployment are deferred.

## Design decisions

Use FastAPI and SQLite with a plain ES-module browser client. Reuse the unchanged Python economic model rather than porting the formulas. A Node-only implementation would duplicate the verified model; static hosting would not meet the multiplayer requirement. Run a single application service against a persistent local disk; a multi-host deployment will need a transactional database migration.

Stay in this newly cloned checkout on codex/multiplayer-build. No worktree is needed for concurrent implementation. Credentials are 256-bit browser-generated rejoin keys, stored hashed on the server and locally in the player's browser. Room code is an invitation, not identity. Show/export the player's key only on explicit request. Never include credentials in URLs.

Persist JSON room snapshots under SQLite BEGIN IMMEDIATE transactions. Strict command schemas, phase/round guards, idempotency receipts and full validation prevent partial mutations and repeated settlement. Use independent server randomness for hazards, events and bid ties. Public projections use explicit allowlists; scan knowledge and objectives remain private. All players acknowledge briefing and upgrades. Resolution and market update are atomic stages, explained in the reveal log rather than artificial timed waits.

## Tasks and checks

1. Server service and persistence (`server/game.py`, `server/store.py`, `server/models.py`): create/join/start, private views, phase guards, scans, purchases, sealed locks, settlement, score and restart persistence. First write `tests/test_game.py` for atomic invalid locks, secret redaction, duplicate requests, recovery and phase flow; run red then green.
2. Preview (`server/game.py`): compute estimates only from own plan, purchased scans, public rules and adjustable rival supply. Test clear/unknown hazards, zero own capacity, bid scenarios and contract opportunity cost.
3. HTTP boundary (`server/app.py`): strict request models, bearer membership, origin restriction, bounded input and rate limiting, JSON errors, static delivery. Test via TestClient; this is implementation verification, not the Step 4 browser/network audit.
4. Browser (`web/`): responsive mission-control dashboard, lobby/rejoin, briefing, planning, market preview, six-part score, reveal, upgrades, history and final standings. Keep input drafts through polling, show save/lock errors, prevent accidental duplicate clicks and persist credentials per room. Node syntax/build checks; single-session browser smoke if available, no full multiplayer match.
5. Packaging (`scripts/build.mjs`, requirements, Dockerfile, `.env.example`, README): build static assets, verify startup/health, document persistent-volume and HTTPS prerequisites. Reproduce saved 2/3/4-player simulator fixtures and run the original 32 checks without modifying frozen files.
6. Review, fix implementation issues, update SPRINT_STATUS.md with evidence and limits, commit and push implementation branch. Stop before Step 4 and Step 5.

## Review focus

- Wrong-seat/cross-room requests, repeated and concurrent locks cannot expose secrets or settle twice.
- Invalid or stale commands cannot partially debit a player or apply in a later phase.
- Recovery cannot mix with normal fleets or be denied by bids; briefing repair is recovery-only.
- Refresh/restart preserves identity, private knowledge and locked plans; polling must preserve unsent edits.
- Every price formula input and all six score components remain visible without leaking current hidden inputs.

## Execution record

- Baseline: 32 existing economy tests pass. Frozen simulation code and rules will remain unchanged.
- Architecture docs checked with Context7 (FastAPI static-file mounting).
- Server, preview, browser, packaging and documentation tasks implemented. Final verification: 32 economy + 16 implementation + 3 client-state tests pass; saved replay fixtures match, static build and dependency checks pass.
- Independent read-only reviewer found response-order and mutable-retry defects; both fixed with failing-then-passing client regressions. Boundary overflow rejection and numeric clipping audit also completed. No frozen economic changes.
- Scope decision: single-browser smoke only, using a local helper for the second seat. Full independent-session match, mobile device verification and deployment remain later stages.
