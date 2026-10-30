# Salvage Exchange — UI polish report

This pass implements `docs/UI_POLISH_MASTER_PROMPT.md` and `docs/UI_CRITIQUE.md`. It starts from `codex/clinical-ui-design` at `59aafee`, the commit the critique reviewed, and is delivered on `claude/dazzling-tesla-8nky8e`. It is not deployed. Verification below is in Chromium only; it is not a production-readiness claim.

## Screen and state inventory

| Surface | States covered |
|---|---|
| Start screen | create, join (including `?room=` invite prefill), saved rooms, restore with rejoin key, code/name/full/started/missing-room errors, unreachable server |
| Lobby | host vs. guest, fewer than two crews (start disabled with reason), presence, open seats, invite copy |
| Briefing | what changed (demand level, price since last round, recorded price history), hazard odds, hazard and event scans (cost, remaining allowance, limit/closed/unaffordable reasons), fuel, recovery, ready, waiting for named crews |
| Planning | destinations with drone chips and bids, Buy / Sell / Hold orders, deliveries, estimate with assumptions, review sheet, lock pending, lock unconfirmed, locked and waiting |
| Results & refit | staged reveal with skip and replay, personal reconciliation, all-crew and audit disclosures, purchases, repair, insurance, retire confirmation, ready, waiting |
| Finished | winner or shared victory with competition ranks, final composition, revealed objectives, recorded round history, no round-7 refit |
| Ledger | empty state, recorded price history, every settled round |
| Always | net worth (six components), connection status, uncertain-command banner, scoped errors, toasts for secondary confirmation, help, rejoin key, leave |

Reused unchanged: the session guards in `web/session.js`, owner-scoped pending receipts and safe retry, per-room/seat/round draft keys (old signed drafts still load), the room-version and session-generation stale-response checks, the preview endpoint, and the market formula and rounding audit content.

## What changed

**Visual language.** Near-black blue surfaces, warm light text and one cyan accent, used only for primary actions, your net worth, links and focus. Each sector has one tint and an original line-art silhouette: a fractured mineral belt, a broken hull, a distorted rift. These are reused in planning, the reveal, the ledger and the start screen. Gain, loss and caution colours always come with a sign, an arrow or words. Inter and JetBrains Mono are self-hosted under the OFL (`web/fonts/`), with tabular numerals throughout. Body text is 16px, dense controls 14px, and nothing visible is under 12px. Spacing follows a 4/8px scale, radii are 4/6/8px, and icons share one 1.5px stroke. Decorative coordinates, tracked micro-capitals, nested boxes and glow are gone.

**Planning as a decision loop.** Sections run Destinations → Orders → Deliveries → Estimate, with jump links and no forced order. Drone chips (click, tap or keyboard) sit inside each sector row, beside its reserve, cost per drone, hazard odds and any private scan. A fleet strip shows each drone as idle, assigned, disabled or insured. Bids sit with their sector, with a disclosure explaining shared access, exclusive access and what is still spent on a loss. Signed number entry is replaced by Buy / Sell / Hold, a stepper and Max, which show holdings, opening price, fee and cash effect. Sale proceeds are labelled as arriving after settlement.

`web/model.js` mirrors the frozen validation rules. It explains problems beside the affected control, computes a rule-based Max (round limit, holding limit and cent-rounded affordability) and never rewrites what the player typed. Max is disabled when nothing more can be traded. The rail on desktop and the dock on phones keep reserved credits, credits left, fuel committed, drones and validation status visible. The review sheet summarises everything and has a single "Lock plan for round N" action. After locking, a read-only summary names the crews still needed.

**Truthful information.** Your total is labelled as including the private objective. Public standings are labelled as excluding objectives until the end. The estimate is headed "Estimated under the assumptions shown", with the assumptions listed beside it (rival extraction slider, no rival trading, 0% unscanned events, expected hazard yields) and bid win/lose scenarios when you bid. It shows "Updating…" while stale, pauses honestly on invalid orders, and invents no confidence figures. One worked example uses this round's numbers to show how extraction moves the supply term. Price charts use recorded quotes only.

**Reveal.** The headline is your public change, your private objective change and your net worth. Six steps follow in settlement order: trades, access, hazards and salvage, repricing, contracts/insurance/depreciation, and score. All values come from settled records. The score step reconciles each component to the public change, with a rounding line if needed, then adds the private objective. Playback takes about 3.1s and runs once per round per device. Skip and Replay are read-only, and with reduced motion the summary appears at once. Market moves name the largest recorded contributions and avoid single-cause claims when several contributed. Formulas, all-crew tables and rounding live in disclosures.

**Surrounding flows.** The start screen offers create and join paths, with the form ahead of the art on phones. The lobby has copy feedback, an invite link containing only the room code, presence and open seats, and the reason the match can't start yet. Briefing leads with what changed. Refit separates purchases from results, explains affordability and next-round effects, and confirms retirement in a dialog that defaults to "Keep drone". The finished screen fixes the old "Planning next move" roster label.

**Phone composition.** Phones get a two-row header with a phase button that opens the full timeline, and a menu instead of horizontal navigation. Sector, order and contract rows run full width. A single fixed dock holds credits left, fuel, the next action, and all six net-worth components in a 4-column grid at 12px or larger, with an info button. Safe-area padding, `interactive-widget=resizes-content` and scroll padding keep the dock off focused controls. Touch targets are at least 44px. Only labelled audit tables scroll sideways.

**Dependable states.** The page is split into keyed regions, so other crews' updates leave drafts, focus, caret, open disclosures and scroll alone. An uncertain command shows a sticky "Not confirmed: Retry safely" banner and blocks new commands until it is resolved. A lock is never shown as successful before the server confirms it. Connection loss shows "Reconnecting…" and keeps the draft. Errors appear beside the control that caused them. Dialogs are native, keyboard-operable and return focus to their opener. Phase changes are announced politely.

**Server.** One addition: at settlement, each member gets a private, read-only report of their own accounting, projected only to them as `you.reports`. Rivals' projections, the public log and every economic value are unchanged. `server/game.py` builds the report; `tests/test_game.py` covers reconciliation, the insurance repair, an uninsured disablement and privacy.

## Preserved

The frozen v0.2 rules and every simulation file are unchanged, and the 32 economy tests pass. Plans, scans and objectives stay server-held. There is still no short selling, loan, sabotage, bot, timeout, undo-after-lock or rematch in real rooms. A later follow-up added a training rival only to the offline guided practice; see `GUIDED_PRACTICE.md`. Every player still acknowledges the reveal before the game advances. Known balance limitations are unchanged and are still stated in How to play.

## What was verified

| Check | Result |
|---|---|
| `simulation/test_economy.py` | 32 pass |
| `python -m unittest discover -s tests` | 25 pass (2 new: settlement report reconciliation and privacy, uninsured disablement split) |
| `npm test` | 18 pass (15 new for `web/model.js`: translation, validation, Max, reservation, ranks, reconciliation, drivers, formatting, timeline, history) |
| Client vs. frozen validator (one-off fuzz, not committed) | 6,000 random plans, 861 valid. Validity verdicts identical; reservation (to the cent) and fuel identical for every valid plan |
| `tests/browser/match.cjs` | Passed on built assets: six rounds, two identities (1440 desktop; 375 touch phone with reduced motion). Every reveal matched server records for both players; final order, titles and all six components per crew matched; no rival secrets in the phone's traffic; no page errors; no overflow |
| `tests/browser/states.cjs` | 11/11 (scenarios listed in `tests/browser/README.md`) |
| `tests/browser/sweep.cjs` | 0 problems across 8 views × 6 sizes (375, 390, 768, 1024, 1440, 1440 at 200%) |
| `tests/browser/four.cjs` | Four identities at 1440/375/768/1024, fifth refused, round settled, no overflow |
| Contrast (tokens) | 60 text/background pairs ≥ 6.36:1; primary button text 12.37:1; control boundaries 3.2–3.7:1 |

## Evidence

- Desktop: [start](screenshots/ui-polish/01-landing-desktop.png), [briefing](screenshots/ui-polish/05-briefing-desktop.png), [planning](screenshots/ui-polish/07-planning-desktop.png), [review](screenshots/ui-polish/09-review-desktop.png), [locked](screenshots/ui-polish/10-locked-waiting-desktop.png), [reveal](screenshots/ui-polish/13-reveal-desktop.png), [refit](screenshots/ui-polish/15-refit-desktop.png), [final](screenshots/ui-polish/16-final-desktop.png), [ledger](screenshots/ui-polish/18-ledger-desktop.png)
- Phone: [lobby](screenshots/ui-polish/04-lobby-phone.png), [briefing](screenshots/ui-polish/06-briefing-phone.png), [planning](screenshots/ui-polish/08-planning-phone.png), [review](screenshots/ui-polish/11-review-phone.png), [reveal](screenshots/ui-polish/14-reveal-phone.png), [final](screenshots/ui-polish/17-final-phone.png)
- Other sizes: [768](screenshots/ui-polish/planning-768.png), [1024](screenshots/ui-polish/planning-1024.png), [1440 at 200%](screenshots/ui-polish/planning-zoom200-1440.png), [four-crew lobby](screenshots/ui-polish/four-lobby-1440.png), [four-crew phone reveal](screenshots/ui-polish/four-reveal-375.png)
- States: [lock sending](screenshots/ui-polish/state-lock-sending.png), [not confirmed](screenshots/ui-polish/state-not-confirmed.png), [blocked review](screenshots/ui-polish/state-review-blocked.png), [reconnecting](screenshots/ui-polish/state-reconnecting.png)
- Reveal recording: [WebM](qa/ui-polish/reveal-sequence.webm), with [start](qa/ui-polish/reveal-frame-0300ms.png) and [end](qa/ui-polish/reveal-frame-3400ms.png) frames. Match results: [JSON](qa/ui-polish/browser-match-results.json)
- Before, captured for this pass: [phone planning](screenshots/ui-polish/before-planning-375.png), [desktop planning](screenshots/ui-polish/before-planning-1440.png). The critique's own `ui-review-mobile-*.png` captures were not supplied, so those links in `UI_CRITIQUE.md` still don't resolve.

## Gaps and limits

- Only Chromium was tested. No Firefox, Safari or WebKit, and no physical phones. iOS on-screen keyboard behaviour and `interactive-widget` support outside Chromium are unverified.
- No screen-reader session with real assistive technology. Labels, roles, focus order, focus return, live regions and reduced motion were checked programmatically and by keyboard only.
- 200% zoom was emulated as a 720×450 viewport at DPR 2.
- Reports exist only for rounds settled after this change. Older rooms fall back to public deltas.
- The estimate covers commodity prices and your haul only (the existing preview), not full net worth, and is labelled that way.
- No sounds were added (optional in the brief), and no rematch (not authorized).
- QA sections C–F, two-device verification and deployment remain outstanding.
