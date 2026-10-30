# Master prompt — finish Salvage Exchange's player experience

Act as a senior game UI designer, interaction designer, and frontend engineer. Improve the existing Salvage Exchange game into a cohesive, polished browser strategy game. Work in the current repository. Deliver working interactions and verified screens, not just a mockup or a new stylesheet.

The desired experience is a salvage crew's working operations console: distinctive wrecks, clear manifests, readable market information, tense simultaneous decisions, and satisfying explanations of their consequences. Avoid a generic dark SaaS dashboard with science-fiction labels attached. “Premium” must come from hierarchy, consistency, craft, and reliable behavior.

## 1. Inspect the existing product before editing

Read `docs/UI_CRITIQUE.md`, `docs/UI_DESIGN_HANDOFF.md`, `docs/ARCHITECTURE.md`, `ECONOMY.md`, `BALANCE_REPORT.md`, and the current frontend and session code. Inspect the actual game at desktop and phone sizes. Review lobby, briefing, planning, waiting, reveal/refit, ledger, and completed-match states. Use isolated test rooms for interactive verification.

The Figma handoff is reference material, not an implemented product or an acceptance certificate. Its mobile frames have documented overflow. Do not copy those defects. Make a brief screen/state inventory and identify what can be reused before changing architecture.

## 2. Preserve the game and its authority

Keep the frozen v0.2 rules, two-to-four players, six rounds, sector and asset identities, prices, fees, position limits, hazards, contracts, insurance, depreciation, recovery, objectives, reservation rules, and scoring. Use the current repository as the source of truth, not the earlier concept pitch.

Do not add short selling, loans, sabotage, bots, automatic turns, disconnect forfeits, undo-after-lock, or new timeout policies as UI polish. Contracts award score rather than spendable credits; trades use opening prices; sale proceeds cannot finance the current plan; newly extracted cargo cannot be sold in the same plan. Make these distinctions easier to understand without changing them. The spec's presentation requirements are frozen too: the player's own six net-worth components stay visible at all times, projections stay labeled as estimates, and every player acknowledges the reveal before the game advances.

Preserve server-held private plans and intelligence, identity restoration, request deduplication, stale-response rejection, and exactly-once settlement. Do not reveal private objectives early, infer opponents' decisions from hidden data, or ship hidden information to the browser for animation. Existing known balance limitations remain separate from this work.

Keep the current stack unless a specific, evidenced limitation demands a change. Any small server projection addition must derive from already authorized information and preserve privacy and economic behavior.

## 3. Establish one intentional visual language

Use restrained industrial science fiction: near-black blue surfaces, warm readable light text, a single primary accent, and consistent semantic colors. Start from the handoff's cyan accent and spacing system; do not scatter every palette color across every card. Separate sector identity from warning/success meaning, and pair meaning-bearing colors with text or symbols.

Use Inter or a comparable readable body face and a restrained monospace face for numeric data. Use tabular numerals. Aim for 16px body text, 14px dense control text, and no essential information below 12px. Prefer sentence case; reserve spaced capitals for a few short labels. Use a 4/8px spacing system, a small radius scale, and consistent icon strokes. Keep stable numeric widths and currency/unit formatting.

Reduce nested boxes, repetitive borders, arbitrary coordinates, excessive badges, and large decorative regions that push decisions below the fold. Use alignment and spacing to create groups. Distinguish actionable controls from informational surfaces.

Give Crystal Belt, Derelict Cruiser, and Void Rift recognizable silhouettes and a consistent illustration style. Prefer lightweight original SVG assets suited to this codebase. Reuse these identities in planning and reveal. Avoid unrelated Unicode glyphs, stock-looking hero art, heavy textures behind text, constant glow, and decorative particle effects.

## 4. Rebuild planning around a visible decision loop

Organize the screen around: choose destinations, set orders, review commitments, lock. Allow players to move freely among these decisions without losing work; do not force a wizard through every field.

On desktop, use a compact room/phase header, a dominant planning workspace, and a persistent summary rail. Bring drone allocation close to sector information. Show destination, usable drones, fuel cost, deployment cost, reserve, hazard odds, and private scan results together. Offer click/tap and keyboard assignment; drag-and-drop may be an enhancement, never the only method. Make idle, assigned, disabled, and insured drones distinguishable.

Keep optional bids available near the relevant sector, with concise explanations of shared access, exclusive access, and what is spent when access is lost. Disclose advanced details on demand rather than hiding required strategic information.

Replace signed-number order entry with Buy / Sell / Hold and quantity controls. Show holdings, opening quote, fee, total cash effect, and applicable limits. Translate these controls to the existing API format. Do not silently change quantities to resolve invalid input. Explain the problem next to the affected control and provide a useful maximum based on the actual rules.

Keep credits reserved, credits remaining, fuel committed, idle drones, and validation status visible. Keep the six net-worth components visible as `ECONOMY.md` requires; an expandable panel may add explanations and history, but must not be the only place they appear. Do not label permanent score or fleet value as spendable money.

Make Review plan accessible without scrolling through all detail. Its review sheet summarizes assignments, bids, orders, fees, fuel, and contract requests. One final “Lock plan” action clearly states that locking is irreversible for the round. After confirmation, retain a read-only summary and identify which crews are still needed. Do not falsely show a successful lock while the server response is uncertain.

## 5. Make information understandable without flattening the strategy

Show short contextual guidance at the decision it explains. Introduce the extraction/supply/price relationship with one accurate example, rather than a compulsory tour or a wall of rules.

Label public standings, your private-inclusive total, and conditional estimates distinctly. Keep rival-supply assumptions, unknown events, and bid scenarios visible beside estimates. Do not invent confidence percentages or guaranteed returns. Use existing supported scenarios and show their assumptions. If adding a full net-worth estimate, account for every relevant component and validate it against the economic model; otherwise describe the narrower estimate accurately.

Use concise market explanations derived from recorded components. Explain dominant contributions without pretending one factor alone caused a move when several contributed. Disclose rounding/capping when necessary. Keep exact formulas and audit tables one deliberate expansion away.

Keep private intelligence visibly private. Distinguish cargo prices from industry share prices while showing their relevant relationship. Use actual recorded history for charts, with clear labels and useful values; do not fill early rounds with fabricated sparkline data.

## 6. Design a satisfying, truthful reveal

After authoritative settlement, offer a short sequence following the actual resolution order: opening-price trades, access decisions, hazards and extraction, market repricing, contracts/insurance/depreciation, and score effects. All displayed outcomes must come from authorized settled state.

Emphasize the player's experience: which destinations were contested, whether their bid won, what returned, which drones were disabled or repaired, how assets moved, and the resulting wealth change. Distinguish public deltas from private objective contributions. Any contribution breakdown must reconcile to the displayed total, including rounding.

Target roughly three to five seconds for the full presentation. Provide Skip and Replay; replay is read-only. Show the settled summary immediately for reduced-motion users. Do not hold the server or other players behind an animation, invent spinning randomness after the result is known, replay automatically on every poll, or show a misleading live phase during recorded playback. Handle reconnection and later phases gracefully.

Use motion for continuity: approximately 100–160ms for control feedback, 180–240ms for panels, and 250–400ms for a result emphasis. Animate opacity and transforms where possible. Avoid large layout shifts, perpetual pulsing, confetti covering information, and bouncing financial values. Sounds are optional, user-enabled, muted by default, and never the sole feedback channel.

## 7. Finish the surrounding flows

Lobby: clear create/join paths, understandable code errors, copy/invite feedback, player presence, host role, and reason the game cannot start. Preserve reconnect access without exposing rejoin credentials in invitation links or screenshots.

Briefing: prioritize what changed this round, readable hazards and demand, private scans with cost and remaining allowance, fuel needs, and one clear readiness action.

Refit: separate the previous result from purchases for the next round. Explain affordability, next-round effect, disabled/insured status, and zero-credit retirement. Use a proportionate confirmation for retirement. Keep all purchase outcomes server-confirmed.

Finished match: correct the roster's “Planning next move” fallback. Present winner or shared victory, consistent tie ranks, final score composition, revealed objectives, and compact round history. Use existing create/join paths for another game unless a rematch feature is separately authorized. Do not offer round-seven upgrades.

## 8. Treat mobile as a separate composition

At 375px, replace the three compressed sector columns with readable full-width rows or cards. Keep a compact current-phase indicator; show the complete timeline on demand. Replace horizontally scrolling navigation with a small clear menu or equivalent accessible control.

Use one compact persistent dock for available credits, committed fuel, and Review plan, with the six net-worth components condensed into it (for example, a two-row grid of short labels and values at 12px or larger) so they remain visible at all times. Expand explanations on tap. Account for safe-area insets, the on-screen keyboard, and scroll padding so the dock never covers focused controls or final actions. Avoid stacking multiple fixed bars.

Provide at least 44px touch targets for primary interactions. Convert routine order tables into readable mobile rows. Horizontal scrolling may be used inside clearly labeled detailed audit tables, never as the default way to operate the game. Preserve drafts and scroll position when opening and closing details.

## 9. Make every interaction state dependable

Define default, hover, keyboard focus, selected, disabled-with-reason, pending, success, and error states where relevant. Place actionable validation near the control; use toasts for secondary confirmation rather than critical information that disappears.

Keep drafts, input focus, text selection, scroll, and open disclosures stable while other players update the room. Avoid replacing the full interface for unrelated changes. Preserve safe pending-command retries; an uncertain response must not produce duplicate purchases or locks. Mark stale/unavailable estimates honestly and never manufacture a success state during reconnection.

Show precise readiness and connection status. Players may still wait indefinitely under existing rules if someone does not return; explain that honestly rather than adding an unauthorized timeout. Provide helpful empty, loading, failed-request, missing-room, full-room, and session-recovery states.

Use semantic controls, visible focus, associated labels/errors, keyboard-operable dialogs with focus return, appropriately restrained live announcements, and reduced-motion support. Meet WCAG AA contrast targets and verify them on the implemented surfaces. Essential hazard or action guidance must work on touch and keyboard, not rely solely on title tooltips.

## 10. Verify and deliver in concrete stages

First complete layout, readable controls, and mobile planning. Then improve state feedback and result explanations. Add motion after these work. Finish with accessibility and visual consistency. Avoid unnecessary dependencies and broad backend rewrites.

Acceptance checks:

- Inspect 375, 390, 768, 1024, and 1440px layouts, plus 200% browser zoom. No unintended page overflow, clipped labels, or obscured actions.
- Verify lobby through final results in a real six-round two-player browser match using separate identities; also inspect a four-player room. API-only tests do not count as browser interaction coverage.
- Verify editing while another player updates, locking last, waiting, refresh/rejoin, delayed responses, failed/retried commands, insufficient resources, disabled drones, private scans, reduced motion, and keyboard-only planning. Use isolated fixtures for difficult-to-reach states where appropriate.
- Verify revealed outcomes and any score decomposition against server records. Check that no hidden information appears in opponent views.
- Run existing relevant client/server checks and add focused regression coverage for newly changed behavior. Preserve frozen economy files. Do not overwrite historical QA evidence casually.
- Capture representative desktop/mobile screenshots and a short reveal recording if tooling permits. Review them for hierarchy, readability, layout, and visual consistency.
- Report what changed, what was actually verified, and any remaining gaps. Do not call it production-ready based only on attractive screenshots. Do not deploy or push unless separately instructed.

The result should let a new player answer three questions quickly: “What can I do now?”, “What will this commitment cost?”, and “Why did my result change?” Experienced players should retain fast access to exact numbers and deeper strategy.
