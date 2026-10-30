# Guided practice and motion

New players found the first match confusing, so the client now teaches the game by playing it. A practice match against a training rival runs entirely in the browser, and a step-by-step guide highlights the real controls and waits for the player to use them. The same pass adds short, purposeful animation throughout the client.

## What the player sees

**Ways in.**
- The start screen has a "New here? Learn by playing" card. It reads "Start guided practice", or "Continue practice · round N" plus "Start over" once a practice exists.
- How to play links to the practice.
- Inside a practice, the menu offers Guide, How to play, Restart practice and Leave practice.

Nothing forces the practice: the brief asked for no compulsory tour, so creating or joining a real room works exactly as before.

**The practice match.** The player is matched against Kestrel Haulers, a training rival with a fixed, simple strategy: Belt and Cruiser runs, sell what it hauled, deliver when it can. The header shows "Practice vs Kestrel Haulers" instead of a room code, and the footer says the match runs only in this browser. Invite, room-code and rejoin-key controls are hidden. After the guide ends, the match continues to round 6 and finishes with "Practise again" or "Back to start screen".

**The guide** has 25 steps over rounds 1 and 2:

| When | What it teaches |
|---|---|
| Round 1 briefing | The goal: net worth and what counts. How salvage moves prices against posted demand. Why richer sites are riskier, using the odds bar. Buying a private hazard scan of the Void Rift, then reading its result. Ready up. |
| Round 1 planning | Plans are sealed until everyone locks. Send Drone 1 to the Belt and Drone 2 to the Cruiser. Sharing a site versus bidding for it. Buy and Sell orders, with one Ferrum Industries share. The estimate and its assumptions. Review, then lock. |
| Round 1 results | Settlement runs the moment both crews lock. Who got access and why. How hazards decided the haul. Why prices moved. What refit offers. |
| Round 2 | Fuel. Selling last round's haul. Delivery contracts pay permanent score. |

Every number in the guide is read from live game state, so the text can't drift from the rules. The hazard words, the largest price move and the comparison of contract score with sale value are computed, not written in advance.

## How the guide behaves

- **It never blocks the page.** A spotlight ring and a mild dim mark the control; only the guide card and its pill take pointer input. The player always uses the real button, chip or field.
- **Action steps wait.** They wait for the action itself, such as a drone chip pressed, a scan bought or the plan locked, and advance on their own. They say exactly what to press. "Show me" scrolls to the control and focuses it. Optional actions (the scan, the second drone, the share) have "Skip step".
- **Information steps** have Next, plus Back to earlier information steps in the same phase.
- **Phase changes move the guide on.** If the player acts ahead of it, for example pressing Ready from the dock, steps for the earlier phase are skipped, never replayed.
- **Placement.** The card sits beside its target when there's room. Otherwise it pins to the top or bottom edge, whichever leaves the start of the target uncovered. It picks its side once per step, from where the target will land after scrolling, so it doesn't jump mid-scroll.
  - On phones it spans the width above the dock and stays clear of it.
  - In the review sheet it moves inside the dialog, after the dialog's entrance finishes.
  - Notices stack above the card instead of covering its buttons.
- **Minimise and end.** The card minimises to a "Guide · step N of 25" pill; × ends the guide. Menu → Guide reopens it at the same step. Position and state survive a reload.
- **Waiting.** It waits for the reveal playback to finish before explaining the result, and hides behind unrelated dialogs.

**Accessibility.**
- The card is a labelled, non-modal dialog.
- After keyboard input, each new step moves focus to the card, so Tab reaches its buttons first. Pointer users keep their focus, and the step is announced through the existing live region instead.
- Targets are 44px or larger on touch and narrow layouts.
- With reduced motion, the ring, card and scrolling move instantly.

## How the practice works

`web/practice.js` runs a room with the same `GameService`, economy and schemas as the Workers server. The build copies `worker/src/{economy,schema,game}.js` into `dist/engine/` and generates `dist/engine/rules.js` from `simulation/rules-v0.2.json`. `tests/worker/` already proves that engine is bit-identical to the Python reference, so practice follows the real rules.

- A small in-memory store implements the `GameService` store contract and mirrors the room to `localStorage` (`sx-practice`, `sx-practice-store`). Reloading resumes the match, and a new practice replaces the old one.
- `api()` in `web/app.js` answers requests carrying the practice key from that module. It uses the same routes, error messages and statuses as the HTTP API. The rest of the client can't tell the difference, and practice makes no network requests.
- **Round 1 is staged** so a first-timer sees every kind of outcome once: normal demand, Belt clear, Cruiser disrupted, Rift severe, and no market events. The welcome step says so. The odds shown are the real ones, and from round 2 every draw is random.
- The rival acts through the same validated commands as a player, about a second after each phase opens, so the crew list visibly updates.

**Scope.**
- Real rooms, the server, the HTTP API and the frozen v0.2 rules are unchanged.
- The brief excluded bots. This adds one only to the offline practice, where it can't reach a real room.
- A practice's hidden draws live in that browser's storage, which is acceptable for a match with no stakes.
- Practice needs the built client (`node scripts/build.mjs`). If the Python server is serving `web/` without a build, the practice button explains this instead of failing silently.

## Motion

Durations follow the brief: about 120ms for control feedback, 200ms for panels and 320ms for emphasis. Only opacity and transform animate, nothing loops, and `prefers-reduced-motion` turns every effect off. The JavaScript count-ups also check the preference.

| Where | What |
|---|---|
| Phase or view change | Sections settle in with a short rise, staggered 40ms apart, once per change. Later updates inside a phase don't animate. |
| Net worth (rail and phone dock) | Briefly tints toward green or red for the direction of change, then counts to the exact new figure in 450ms. |
| Reveal headline | Counts from 0 to your public change during playback. Skip and reduced motion show the final figure at once. |
| Buy / Sell / Hold, Create / Join | A thumb slides to the chosen side. |
| Drone chips | The drone icon lifts when sent; its fleet card and sector card light up. |
| Dialogs | Fade and lift in, and fade out on close, using `@starting-style`. Browsers without it open and close instantly. |
| Start screen | Intro, entry form, practice card and site cards rise in once. |
| Locked plan | The lock icon pops once. |
| Guide | The ring glides between targets and pings twice on a new step. The progress bar fills; the card fades in. |

Count-ups never overshoot and always end on the server's exact value. Sampling in Chromium confirmed this; see Verification.

**Fixed along the way:** a pressed drone chip went blank while the pointer was still over it, because the hover colour matched the pressed background. It affected real matches too.

## Verification

| Check | Result |
|---|---|
| `tests/practice.test.mjs` (in `npm test`) | A full six-round practice with the rival. The staged round 1 is checked: severe Rift scan, Belt shared 2.25 / 2.25, Cruiser at half yield. Also checked: server-identical error statuses and messages, `fetch` never called, replacing a practice, and guide step order, uniqueness and done conditions |
| `tests/browser/tutorial.cjs` | All 25 steps played the way a newcomer would, followed by the rest of the match and a reload, at four setups: 1440 desktop; 375 touch phone with reduced motion; 768 touch tablet; and 1024 keyboard-only. At every step: the card is on screen and clear of the phone dock, and doesn't cover the control to press or the start of its target; there are no small touch targets, no overflow, no page errors and **0 API requests**. Keyboard-only: every step reached and operated with Tab and Enter, with focus on the guide after each step. Passed against both the Python server and the local Worker (`wrangler dev`) |
| Motion sampling (one-off script) | Net worth, the reveal headline and the order thumb all animate and settle on exact values. Dialog opacity runs 0 → 1 on open and 1 → 0 on close, with `open` false immediately. With reduced motion, none of them animate |
| Existing suites, after the change | `match.cjs` passed on Python and on the Worker; `states.cjs` 11/11; `sweep.cjs` 0 problems across 8 views × 6 sizes; `four.cjs` passed; `npm test` 22/22; Python 25/25; economy 32/32; `npm run test:worker` 3/3 |

## Evidence

- Start: [desktop](screenshots/guided-practice/01-start-desktop.png), [continue](screenshots/guided-practice/02-continue-desktop.png), [phone](screenshots/guided-practice/03-start-phone.png)
- Desktop guide: [welcome](screenshots/guided-practice/04-welcome-desktop.png), [scan](screenshots/guided-practice/05-scan-desktop.png), [send a drone](screenshots/guided-practice/06-send-drone-desktop.png), [lock in the review](screenshots/guided-practice/07-lock-in-review-desktop.png), [hazards in the reveal](screenshots/guided-practice/08-reveal-hazards-desktop.png), [last step](screenshots/guided-practice/09-finish-desktop.png), [practice complete](screenshots/guided-practice/14-practice-complete-desktop.png)
- Phone guide: [send a drone](screenshots/guided-practice/10-send-drone-phone.png), [buy a share](screenshots/guided-practice/11-buy-share-phone.png), [lock in the review sheet](screenshots/guided-practice/12-lock-in-review-phone.png), [result](screenshots/guided-practice/13-result-phone.png)

## Limits

- Chromium only; no Firefox, Safari or physical phones. Dialog exit fades need `@starting-style` support, and other browsers close instantly.
- No session with a real screen reader. Roles, labels, focus and announcements were checked programmatically and by keyboard.
- Guide text is English only and written for the v0.2 rules. If the rules change, the step text needs a review even though its numbers update automatically.
- The training rival is deliberately simple and is not a balance benchmark.
- Practice is per browser. It isn't synced between devices and doesn't appear in "Your rooms".
