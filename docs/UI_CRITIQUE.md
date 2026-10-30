# Salvage Exchange — UI critique

Reviewed 28 October 2026 against local commit `59aafee` on `codex/clinical-ui-design`.

## Overall assessment

The interface has a coherent starting palette and a functioning strategic game underneath it. Its biggest weakness is that it presents a game as a long administrative dashboard. Much of the visual attention goes to decorative labels, repeated boxes, and statistics; the player's next decision and the consequences of the previous decision receive less attention.

“AI generated” is an impression, not something appearance can establish. Here that impression comes from familiar dark-dashboard conventions, interchangeable geometric artwork, repetitive card layouts, and limited attention to the small interaction states that make a product feel deliberately designed. Changing the accent color or adding glow would not address those causes.

## What was inspected

- The running planning screen, including its 375 × 812 mobile layout and controls below the fold. No plan was submitted or match advanced during this review.
- The saved desktop planning screenshot and the QA team's final-results screenshot.
- Current frontend rendering, controls, responsive styles, session guards, reveal templates, and help copy.
- The repository's UI design handoff and QA A–B report. The Figma frames themselves were not independently inspected. The handoff explicitly describes an unimplemented design and unfinished mobile frames.

This is a visual and interaction critique, not a fresh full-match usability study, accessibility certification, or balance assessment. Source-level risks below are distinguished from reproduced behavior.

## Findings and remedies

| Priority | Finding | Why it matters | Recommended change |
| --- | --- | --- | --- |
| First | The planning screen spreads one decision across sector cards, drone dropdowns, bids, orders, contracts, estimates, and a bottom-only lock action. | Players must remember costs while scrolling between controls and their consequences. | Bring fleet assignment into the sector decision area; keep a concise plan summary and review action visible. Put detailed math behind disclosures. |
| First | On the observed 375px screen, navigation and phase tracking both scroll horizontally. Three sector cards remain side by side with very small labels. | The mobile layout shrinks desktop content instead of arranging it for touch and reading. | Use one-column sector rows, a compact current-phase header, and a small navigation menu. Show the full timeline on demand. |
| First | A fixed mobile panel displays all six wealth components while planning controls remain further down the page. | Persistent space goes to large accounting cells, while the numbers the current decision needs—credits left after reservations, fuel, plan status—are absent. | Merge it into one compact action dock: credits available after reservations, fuel committed, plan status, and Review plan, with the six net-worth components condensed alongside. `ECONOMY.md` requires those six to stay visible at all times, so condense them rather than hiding them; tapping may add labels and explanations. |
| First | Buy and sell are represented by positive and negative numbers in the same input. | The interface asks players to remember a sign convention and calculate effects themselves. | Explicit Buy / Sell / Hold controls, quantity, owned units, price, fee, and total. Map this back to the existing signed server order format. |
| First | There is no staged outcome presentation in the current reveal template; tables and formulas carry the result. | The central drama—who contested your sector, what returned, and why the market moved—is easy to miss. | Lead with a personal result and a short, skippable reveal based on settled server data. Keep all tables accessible afterward. |
| Next | Tiny tracked capitals, decorative coordinates, many borders, and nested panels compete with meaningful content. Some mobile CSS labels reach 5–8px. | The interface feels busy even though much of its surface is empty space. | Establish a readable type scale, remove nonfunctional microcopy, and group related controls with spacing before adding borders. |
| Next | Sector art is mostly three geometric symbols inside similar orbital ellipses. | Sectors have names but little memorable visual character. | Create three consistent, recognizable salvage silhouettes: fractured mineral belt, broken ship hull, and distorted rift. Reuse their identities in assignment, reveal, and history. |
| Next | Public scores, private-inclusive net worth, and conditional market estimates coexist but have unequal explanatory emphasis. | Players may compare unlike totals or read an estimate as a promise. | Label “Your total — includes private objective,” “Public standings,” and “Estimated under these assumptions” at the point of use. Separate spendable credits from permanent score. |
| Next | Readiness, connection, and phase states need more precise copy. The QA report records “Planning next move” after game completion. | Contradictory or vague state labels undermine confidence in multiplayer synchronization. | Use explicit phase-aware status text: Reviewing briefing, Editing plan, Plan locked, Reconnecting, Refit ready, Match complete. Show who is still needed without disclosing decisions. |
| Next | State updates can replace the entire app DOM; the code restores an input ID and selection where possible. | Expanded details, focus, and future animations could be disrupted by unrelated updates. This is an architectural risk, not a typing-loss reproduction in this review. | Update stable regions, retain local interaction state, and verify typing, focus, scroll, and disclosures while another player changes state. Preserve existing stale-response and retry guards. |
| Later | The final screen emphasizes a winner card, while the journey is largely left to the ledger. | The match ends without a strong explanation of how the result happened. | Add final score composition and a compact round history using recorded data. Handle ties consistently. Keep new rematch mechanics separate from this polish scope. |

## What to retain

- The distinct salvage-and-market premise and concise “Crack the wreck. Play the market” language.
- Public hazard odds and private intelligence as strategic information, not decorative flavor.
- Transparent market explanations and precise accounting, accessible below the initial summary.
- The separation between public standings and private objectives.
- Saved identity, local drafts, safe retries, and server-controlled resolution.
- The existing implementation's restraint: it does not need a new framework, 3D renderer, or constant visual effects to become convincing.

## Proposed product direction

Make it feel like a salvage crew's working operations console: clear manifests, readable quotes, recognizable wrecks, and one strong decision per phase. Use the existing design handoff's spacing and restrained accent direction as a starting point, but solve layout and interaction before copying its components. Its mobile frames remain drafts.

The defining moment should be a useful round reveal: “This is where crews went; this is what happened; this is why your wealth changed.” Motion earns its place when it establishes that causal sequence. Background particles and continuously pulsing controls do not.

Implement in this order: planning hierarchy and mobile layout; order entry and reliable states; outcome explanation and restrained motion; final-results polish and accessibility verification. Preserve the frozen v0.2 economy throughout. Known balance limitations require separate work and should not be disguised with stronger marketing copy.

## Evidence

- [Desktop planning](screenshots/step3-planning.png)
- [Mobile planning, captured during this review](screenshots/ui-review-mobile-planning.png)
- [Mobile controls, captured during this review](screenshots/ui-review-mobile-controls.png)
- [Earlier QA final-results capture](qa/ab-final-screen.png)
- [Existing design handoff](UI_DESIGN_HANDOFF.md)
- [QA A–B report and outstanding scope](QA_REPORT_AB.md)
- Implementation: `web/app.js`, `web/styles.css`, `web/session.js`.

The companion [master prompt](UI_POLISH_MASTER_PROMPT.md) turns these findings into an implementation brief. This review did not change application code.
