# SALVAGE EXCHANGE — Sprint 2 simulation report

Date: 25 October 2026 (Asia/Karachi). Frozen economy: v0.2.

The four-player mixed-strategy benchmark meets the requested approximately 40% ceiling: the highest aggregate rate is 30.83%, and the highest rate in any of the five four-distinct-strategy lineups is 35.35%. This is evidence about the specified bots and opponent fields, not proof that every possible matchup is balanced. Duplicate-strategy stress tests expose strong counters, detailed below. The full game, browser testing, and deployment remain Steps 3–5.

## What ran

35,800 complete six-round matches using the frozen rules, in addition to baseline and tuning experiments. The principal holdout contains 10,000 matches: 2,000 for each of the five possible four-distinct-policy lineups. Every policy appears in 8,000 matches. Seats and the four distinct secret objectives are shuffled independently of policy choices. Tied winners share the win. The final holdout seeds were not used for parameter selection.

| Suite | Matches | Lineups | Seed | Raw evidence |
|---|---:|---:|---:|---|
| distinct | 10,000 | 5 | 20401027 | simulation/results/final-holdout.json |
| duplicates | 14,000 | 70 | 20411027 | simulation/results/final-duplicates.json |
| adversarial | 6,000 | 40 | 20421027 | simulation/results/final-adversarial.json |
| scan_ablation | 1,800 | 6 | 20431027 | simulation/results/final-scan-ablation.json |
| two_player | 2,000 | 10 | 20441027 | simulation/results/final-two-player.json |
| three_player | 2,000 | 10 | 20451027 | simulation/results/final-three-player.json |

All final result files match the current rules JSON and economic-model SHA-256 `9272b9fa17a84c2e1630431fc6e8790e2b32dcc659318904500797ada5726fdc`. Result files retain the exact parameters, seeds, policy revision, and per-lineup samples. Earlier candidates and exploratory sweeps are retained separately and are excluded from the final counts.

## Policy definitions

- Heavy extractor: expands toward five drones during the first three upgrades if it can keep 180 credits in reserve; chooses expected salvage value after fuel and launch costs, bids up to 20% of estimated gross sector value, and invests spare cash.
- Safe hauler: expands toward three drones; applies a larger penalty to uncertain damage and costly sectors, uses the same 20% bid-value ceiling, keeps operating liquidity, and invests spare cash. It does not waste money on random insurance purchases.
- Scanner-heavy: targets three drones, scans the Rift and Cruiser when affordable, buys the scanner upgrade early when affordable, allocates using its purchased hazard results, and bids up to 24% of estimated gross value. It does not see opponents' plans.
- Pure trader: never deploys or buys drones and never scans; forecasts commodity and stock movement from public demand and revealed history, trades within limits, and can deliver profitable contracts using owned cargo. Its starting drones still depreciate.
- Random: randomizes feasible sector choices and investment preferences, makes randomized bounded bids, occasionally scans, and sometimes expands to four drones. It still follows validation, budgeting, sale limits, and contract eligibility. It is a legal randomized policy, not intentionally destructive spending.

All policy planners receive only own state, public prices/demand, past reveals, and their own purchased scan results. The offline engine holds current hazards and events separately. This checks simulation information hygiene; it is not verification of a multiplayer API, which does not exist yet.

## Four-player results

Baseline below uses the same corrected policy revision as the final run, so changes in bot quality are not presented as changes in economic balance. The earliest exploratory baseline used a weaker cautious bidder and is retained in baseline.json; its rates should not be compared causally with the final policies.

| Strategy | v0.1 baseline win rate | v0.2 holdout win rate | Approx. 95% Wilson interval | Mean final net worth | Duplicate-field win rate |
|---|---:|---:|---|---:|---:|
| Heavy Extractor | 32.65% | 18.26% | 17.43%–19.12% | 1,239.45 | 24.55% |
| Safe Hauler | 33.81% | 30.83% | 29.82%–31.85% | 1,392.54 | 31.78% |
| Scanner Heavy | 40.64% | 26.92% | 25.96%–27.91% | 1,298.79 | 26.15% |
| Pure Trader | 0.18% | 25.27% | 24.34%–26.24% | 1,496.85 | 14.33% |
| Random | 17.72% | 23.71% | 22.79%–24.66% | 1,332.24 | 28.20% |

Each rate divides wins by that policy's appearances, not by all matches. These five rates therefore do not sum to 100%: each match contains four of the five policies. Equal performance would be approximately 25% per policy. Confidence intervals describe Monte Carlo uncertainty for these fixed policies, not uncertainty about human strategies. Duplicate-field intervals are not used for conclusions because seats of the same policy within a match are correlated.

| Four-distinct-policy lineup | Per-policy win rates |
|---|---|
| Heavy Extractor, Safe Hauler, Scanner Heavy, Pure Trader | Heavy Extractor 13.95%; Safe Hauler 27.05%; Scanner Heavy 24.30%; Pure Trader 34.70% |
| Heavy Extractor, Safe Hauler, Scanner Heavy, Random | Heavy Extractor 14.15%; Safe Hauler 27.20%; Scanner Heavy 24.35%; Random 34.30% |
| Heavy Extractor, Safe Hauler, Pure Trader, Random | Heavy Extractor 20.75%; Safe Hauler 33.70%; Pure Trader 19.95%; Random 25.60% |
| Heavy Extractor, Scanner Heavy, Pure Trader, Random | Heavy Extractor 24.20%; Scanner Heavy 30.45%; Pure Trader 26.35%; Random 19.00% |
| Safe Hauler, Scanner Heavy, Pure Trader, Random | Safe Hauler 35.35%; Scanner Heavy 28.60%; Pure Trader 20.10%; Random 15.95% |

The highest individual-lineup rate, 35.35%, has a Wilson interval of 33.28%–37.47%. No primary-field strategy or lineup breaches 40%.

## Parameter changes

| Parameter | v0.1 | v0.2 |
|---|---|---|
| Drone purchase and initial book value | 180 | 260 |
| Belt / Cruiser / Rift capacity per drone | 4 / 3 / 2.5 | 3 / 2.25 / 1.875 |
| Belt / Cruiser / Rift reserve per player | 3 / 2 / 1.5 | 2.25 / 1.5 / 1.125 |
| Neutral Alloy demand per player | 3 | 2.25 |
| Stock profitability coefficient | 0.10 | 0.35 |
| Emergency access | Could be blocked by bids | Protected 1.5-unit Belt capacity, deducted from existing reserve |
| Price rounding | Nearest cent after return cap | Also enforce inward cent bounds at ±25% |

Starting cash, starting drone count, starting fuel, hazard odds, commodity base prices, fees, scan prices, stock/order limits, depreciation, contracts, and objectives remain unchanged. Ferrum's background output follows the changed Alloy demand; its baseline profit becomes 27.75. The commodity market and company stock formulas remain separate.

The early sweeps tested higher minimum bids, more expensive scans, different fleet costs, and different yield/stock sensitivities. Higher minimum bids made exclusion worse for cautious bidders and were rejected. Reducing production and making fleet expansion more expensive stopped salvage from overwhelming investing; stronger profit sensitivity made the pure trader viable in the mixed field. Alloy demand was reduced with capacity so a large Alloy haul can still cause a real glut rather than a permanent shortage. A regression test checks that extracting 9 Alloys against low demand of 7.2 moves the base quote from 24 to 23.28 with no other signals.

## Wealth, objectives, and runaway checks

Primary-field median winning net worth: 1,661.46 credits. The middle 90% of winning scores spans 1,330.77–2,099.42. All-player median: 1,357.17; 99th percentile: 2,129.35; maximum: 2,956.07.

Across all 35,800 final-rules matches, the maximum observed final score was 3,430.61; the largest observed asset price was 3.3142 times its base. No reserve, price, nonnegative-credit, fuel, or stock-position assertion failed. These finite six-round samples found no runaway wealth; they are not a mathematical proof against every possible policy.

The 120-credit objective cap is 7.22% of the median winning score, within the requested 5–10% maximum-bonus target. Actual earned bonuses averaged 4.02% of winning wealth because not every winner caps its objective. Objective-conditioned win rates were Industrial Titan 26.52%, Market Shark 28.56%, Tech Pioneer 26.24%, and Logistics Empire 18.68%. Logistics is weaker for these policies and remains a human-playtest tuning concern; this report does not claim objective parity.

## Exploits, recovery, and scan value

32 regression/invariant tests pass. They cover exact price examples, company profitability, price caps after rounding, allocation/reserve conservation, bid ties and payment, deployment costs for denied bids, fuel, hazards, insurance, depreciation, fee round trips, all-bid cash reservation, blocked short sales and future-sale financing, position/order limits, contract consumption and one-time rewards, investment-loss offsets, objective caps, scan budgets, recovery eligibility, and deterministic replay. A separate 10,000-transition price stress test is included in this count.

| Attack policy | Appearances | Win rate against three distinct standard policies |
|---|---:|---:|
| One Credit Raider | 1,500 | 0.07% |
| Bid Monopolist | 1,500 | 27.20% |
| Hoarder | 1,500 | 0.07% |
| Pump Trader | 1,500 | 18.60% |

The four attacks are fixed-minimum bidding across sectors; aggressive bids up to half estimated gross yield; holding starting cash and fleet idle; and concentrating purchases into one stock to maximize its own order pressure. No attack exceeded 40% in aggregate. This is a targeted probe set, not an exhaustive search over adaptive adversaries or collusion.

The blocked-recovery exploit was real in v0.1: exclusive rights could deny a bankrupt player every yield. v0.2 reserves emergency Belt capacity before auction allocation, without increasing the sector reserve. Tests force a broke player through protected salvage, selling, repairing, refueling, and a valid normal mission; losses and damaged fleet are not reset. Recovery drones appeared 4 times in the final stochastic suite, so forced scenarios provide stronger coverage than the rare natural cases.

Own-order pressure alone cannot pay for a buy-then-sell fee loop at the tested maximum orders: the commodity pressure cap is 4%, below the 4.0816% rise needed to cover two 2% fees; stock pressure is capped at 2%. The model also enforces one net order per asset per round. A bounded terminal mark-to-market incentive remains: in an isolated neutral-price probe, a player holding 16 Alloys and buying 4 improves marked score by 6.68 credits through its own price impact after purchase fees. This is not free liquidation profit; trading pressure is intentionally part of the market, but close-game end-mark manipulation needs human playtesting. See terminal-mark-probe.json.

In 1,800 matches comparing scanner-heavy play with the same allocation/bidding style without scans, the scanning policy won 24.06%, versus 23.78% without scans. Mean scores were 1,181.49 versus 1,215.92. Their intervals overlap: buying two scans every round is not reliably profitable. A scan reveals useful information, but access competition and its cost still matter. Selective scan timing is not optimized by these bots.

## Matchup limits — do not hide behind the aggregate

The 14,000-match duplicate-policy suite spans all 70 four-seat multisets and keeps each policy's aggregate rate below 40%. Nevertheless, a single scanner-heavy extractor against three pure traders won 100.00% of its 200 games. Uncontested extraction strongly counters a room where everybody else refuses to mine. This violates any interpretation of “below 40%” that requires every possible opponent composition to be balanced; that stronger condition has not been achieved. The primary mixed-policy benchmark target has been achieved.

In the separate attack-insertion field, safe hauler and scanner-heavy aggregate rates are 41.17% and 40.53%, respectively. Those fields include weak cash-hoarding and minimum-bid opponents. Their individual counter-matchups also exceed 40%, although the attack policies themselves do not dominate.

Two- and three-player rules execute successfully, but their strategic balance is not equivalent to four-player balance. Pure trader wins only 0.88% in the two-player field and 10.75% in the three-player field. The two-player neutral benchmark is 50%, not 25%. The game must still support these room sizes; these results are an explicit alpha limitation, not permission to remove them.

Bots are bounded heuristics. They do not optimize all contracts, selective scans, final-round insurance, opponent learning, or collusion. No human usability, 15–20 minute duration, device support, reconnect behavior, or network privacy claim follows from these simulations. Those remain implementation and testing obligations.

## Reproduce and next step

Run `python simulation/reproduce.py`, then `python simulation/report.py` from the project folder. Run `python simulation/test_economy.py` for the standalone checks. No third-party dependencies are required. The report verifies rules and source fingerprints before accepting saved results.

The user requested one process step at a time. Stop after presenting this report. Step 3 is to build the full multiplayer game using ECONOMY.md and rules-v0.2.json, retaining the limitations above for review. Do not begin it until the user says “continue”.
