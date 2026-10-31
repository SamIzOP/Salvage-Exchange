# Training missions: lesson and state specification

"Learn by playing" teaches the game through four short missions, played with the real controls against a training rival. Vale, the yard dispatcher, runs them. Everything happens in the browser on the same engine as the server. This replaces the earlier 25-step guide: the guidance now teaches decisions and their consequences, not just which button to press.

## Entry points and flow

**Ways in.**
- The start screen's "New here? Learn by playing" card offers **Learn by playing** (missions) and **Free practice** (the same match with no staging and no guidance). Once a practice exists, it offers **Continue practice · round N** and **Start the missions again**.
- How to play links to the missions.
- In practice, the menu offers **Missions** (status, start, retry), How to play, Restart practice and Leave practice.

**Not compulsory.** Creating or joining a room is unchanged and never waits on the tutorial.

**The panel.** Each mission shows one inline panel at the top of the page, not a floating overlay. It holds:
- the objective;
- one line of training-rival intel;
- the steps as a short checklist;
- at most two sentences of guidance;
- Show me, Hint and Hide guidance.

Show me scrolls to the relevant control and focuses it. That control alone is outlined, and a callout beside it repeats the instruction with its consequence, so the control, its consequence and the guidance sit together. On phones the checklist and intel fold behind "Objective and steps", and the panel stays under 55% of the screen during decisions (tested at 375 and 390 px).

**After each mission round settles,** the panel becomes a debrief with the result, a reconciliation table and the lesson. It offers **Start mission N+1** and **Retry mission N**. On phones the long explanation folds behind "Full explanation" and the buttons stay on the first screen.

**At the end,** a personal debrief lists each mission's result and net-worth change. It offers retry for any mission, continuing free practice, or going to multiplayer.

## The four missions

All scripted draws are labelled training scenarios chosen from valid outcomes:
- demand multipliers from {0.8, 1, 1.2};
- hazards from {clear, disrupted, severe};
- events from {−8%, 0, +8%}.

They live in `web/missions.js` (`SCRIPT`), and the training rival's plan for each mission round is announced in the panel. Live multiplayer rules are untouched, and nothing implies that practice outcomes predict real matches.

| | Mission 1: Recover your first cargo | Mission 2: Turn a haul into usable cash | Mission 3: Read the competition | Mission 4: Make your own plan |
|---|---|---|---|---|
| Starting state | Round 1 of a new training match: 750 cr, 8 fuel, two drones | Round 2, continuing the player's own match; needs cargo in the hold | Round 3, continuing; needs a working drone | A prepared yard: round 4 of a canonical match, empty tank, Alloys and Relic Tech in the hold |
| Scenario | Belt clear, Cruiser disrupted, Rift severe; normal demand. Rival: one drone to the Belt, one to the Cruiser | Belt and Cruiser clear, Rift disrupted. Rival: both drones to the Cruiser, leaving the Belt free | Alloy demand 0.8×, Relic Tech 1.2×; Belt clear, Cruiser severe, Rift clear. Rival: both drones crowd the Belt | Belt disrupted, Cruiser clear, Rift severe (hidden); Power Cores +8% event. Rival: Belt and Cruiser |
| Learning objective | Recovered cargo, credits and net worth are different things; a haul has to outweigh deployment and depreciation | Selling converts cargo to cash at the opening price minus the fee, and only the fee changes wealth. Proceeds can't fund this plan, and this round's haul can't be sold until next round. Contracts pay score, not cash | Crowding raises supply, which pushes one term of the price down. Scans pay only when they change a decision. Shares follow company profit, not a guaranteed hedge | Plan independently toward a stated objective under real uncertainty |
| Directed check (exact state) | A drone is assigned to the Crystal Belt; review opened; plan locked | A sell order for a cargo the player holds; plan locked | Prediction answered; a drone assigned; plan locked | None; the objective is the check |
| Valid alternatives and honest response | Sending a drone elsewhere shows "You've sent a drone to the Derelict Cruiser instead…" and the step does not tick. Locking anyway is allowed, and the debrief judges the actual haul | Holding everything, selling different cargo, or going for Hull restoration (keep Alloys, both drones to the free Belt, request the contract) are all valid. The debrief explains whichever happened | Any destination. A wrong prediction gets a correction with the real mechanism | Any legal plan |
| Hints | — | — | — | Staged: (1) what to look at (fuel, hold, odds); (2) the trade-off (fuel cost and availability, severe hazards vs the both-drones-working objective); (3) a worked example, labelled as not guaranteed |
| Completion | Cargo recovered (`gains > 0`) | The settled round includes a sale of held cargo | Prediction made and the round settled | Net worth at settlement above net worth at the start of round 4's briefing, and no drone left disabled. Labelled "Not guaranteed: the hazards are already rolled and sealed" |
| Consequence explanation | Haul value at the new prices; deployment; fleet depreciation (12% a round, flying or not); idle drones; reconciliation table; fuel used in units | Each sale as cargo notional → cash and fee; any delivered contract (cargo used, score added, objective bonus); any requested but undelivered contract; reconciliation | Units and their value; the Alloy supply term against the total move (actual terms from the log); what each scan did or didn't change; Ferrum's profit formula with this round's numbers; why habitual scanning, bidding or chasing shares costs money | Start and finish net worth and both changes, with briefing spend shown separately; where drones went and what each site's hazard was; the estimate shown at lock time against deployment and depreciation. A sound plan that a sealed hazard defeated is called sound |
| Recovery path | Retry from the round 1 checkpoint (the same sealed draws) | If the hold is empty: load a prepared yard or retry mission 1 | If no working drone: load a prepared yard or retry mission 2 | An empty tank in planning: "fuel is only sold in briefing and refit", then retry mission 4. Retry restores the start of round 4 |

The figures in guidance and debriefs come from the live state, the plan, or the settled round report and log. Nothing is a hand-written counterfactual: mission 2 states conditional facts ("your drones there could bring back up to 4.5 more") and never invents an outcome.

**Mission 4's achievability is tested with the engine.** From the prepared yard:
- Belt plus Cruiser (the worked example) meets the objective, and so do two drones to the Cruiser.
- A drone to the Rift is disabled, and staying docked loses value to depreciation.
- Two drones to the Belt, a reasonable plan by the posted odds, settle just below the starting net worth because the sealed disruption halves the haul. The debrief recognises that reasoning.

## State, checkpoints and prepared yards

- **Practice state** lives in this browser only: `sx-practice` (meta: code, keys, name, training flag), `sx-practice-store` (the room), `sx-practice-checkpoints` and `sx-missions-<code>` (active mission, results, flags, hint levels, panel state). If storage fails, the match keeps running in memory for the visit.
- **Checkpoints.** A copy of the practice room is taken when each mission's briefing first appears. Retrying restores it exactly, with the same sealed draws and the same rival script, and drops later checkpoints and results. Retry exists only in practice; live rooms have no undo.
- **Prepared yards** (`practice.prepared(n)`) are not written by hand. The engine replays a fresh copy of the training match up to mission `n`, using the canonical plans in `missions.js` (`CANON`) and the rival's scripted plans. Mission 4 always starts from one, as "a new, valid scenario". Missions 2 and 3 offer one when the player's own state can't support the lesson.
- **Robustness.** Guidance is derived from game state, not from button presses, so it keeps up with:
  - an action taken ahead of the guide;
  - unexpected phase changes and reloads;
  - invalid plans: Review lists fixes, and the panel says so;
  - minimising the panel, and keyboard-only play.

  If the mission code throws, the panel hides and play continues.
- **Isolation.** Practice requests never reach the network. Restoring a checkpoint never touches `sx-sessions` or `sx-active`. Leaving practice and reopening a live room uses that room's own key. All three are tested.

## Measured, not advertised

The UI no longer quotes a duration. Measured instead:

| Mission | Words of guidance | Words of debrief | Steps |
|---|---|---|---|
| 1 | 147 | 91 | 4 |
| 2 | 152 | 116 | 3 |
| 3 | 201 | 180 | 4 |
| 4 | 80 | 105 | 2 |

That's about 5.3 minutes of reading at 200 words a minute, plus play. In the automated walkthrough the first meaningful action (a drone assigned) happens about 2 s after pressing Learn by playing. That's a script that clicks instantly; no human walkthrough was timed.

## Verification

| Check | Result |
|---|---|
| `tests/practice.test.mjs` (in `npm test`) | 10 tests covering: rules module equals the JSON; staged draws are valid outcomes, staged once, before the player sees them, with the rival following its announced plan; free practice plays six rounds; server-identical errors; checkpoint restore is exact and leaves live-room keys alone; prepared yards meet every mission's needs; mission 4 achievability (above); exact step predicates and honest alternatives; debrief accounting reconciles to the cent with fuel kept out of values; every module the client loads exists in `web/` and `dist/`, and removed files don't linger |
| `tests/browser/missions.cjs` | All four missions through the real UI at 1440 desktop, 375 phone (reduced motion), 390 phone and 1024 keyboard-only. Covers a failed mission 1 and its retry, a wrong mission 3 prediction, mission 4's empty tank and retry, all hints, the final debrief, free practice, and leaving practice to reopen a live room with its own key. Every stage checks overflow, touch targets and phone panel size. 0 API requests during practice. Passed against the Python server and the local Worker |
| Existing suites | `match.cjs`, `states.cjs` (11/11), `sweep.cjs` (0 problems) and `four.cjs` pass with the new planning field |

Browsers: Chromium only (Playwright's bundled build). No Firefox, Safari or real phones, and no session with a screen reader.
