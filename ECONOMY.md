# SALVAGE EXCHANGE — alpha economy v0.2

Sprint 2 deliverable. Parameters are frozen for the first build after the offline simulation benchmark. See BALANCE_REPORT.md for measured results, matchup sensitivity, and limitations; this is not a claim of universal balance. The original proposal is preserved in simulation/economy-v0.1.md, and the exact machine-readable parameters are in simulation/rules-v0.2.json. Do not begin Step 3 (BUILD) until the user says “continue”.

## Match and resources

| Rule | Exact proposal |
|---|---|
| Players / rounds | 2–4 / 6 |
| Starting resources | 750 credits, 2 basic drones, 8 fuel, no securities or cargo |
| Fleet limit | 5 owned drones |
| Basic drone | 260 credits; one sector assignment per round; starting drones each have 260 book value |
| Fuel | 8 credits/unit; tank limit 16; no resale or terminal score value |
| Deployment | 6 credits per assigned normal drone, including denied access |
| Fuel per assigned normal drone | Belt 1; Cruiser 2; Rift 3, consumed even if denied access |
| Depreciation | Each owned drone's book value × 0.88 after every resolution, including idle and disabled drones |
| Drone damage / repair | Hazard can disable a drone; 30 credits repairs one disabled drone during upgrades |
| Fleet score value | Functional: current book value; disabled: 25% of current book value; emergency drone: 0 |
| Fleet transactions | No drone resale; retiring a drone pays 0 |
| Numerical precision | Credits and prices rounded to nearest 0.01, half up; cargo to 0.001 units, down; shares and fuel are integers |

Purchases in reveal/upgrade become usable next round. Newly purchased drones first depreciate after their first eligible round. Fuel can also be bought during briefing, before plans lock. No upgrades after round 6; calculate final score immediately after final contracts and objective bonus.

## Commodities and sectors

| Commodity | Base price | Price floor | Price ceiling | Neutral demand / player / round |
|---|---:|---:|---:|---:|
| Alloys | 24 | 6 | 96 | 2.25 units |
| Power Cores | 42 | 10.50 | 168 | 1.5 units |
| Relic Tech | 72 | 18 | 288 | 0.75 units |

Each sector produces one commodity. For N players, sector reserves below reset each round. Drones share a finite reserve; extra drones cannot manufacture extra reserve.

| Sector | Commodity | Capacity / normal drone | Sector reserve | Clear | Disruption | Severe |
|---|---|---:|---:|---:|---:|---:|
| Crystal Belt | Alloys | 3 units | 2.25 × N units | 85% | 15% | 0% |
| Derelict Cruiser | Power Cores | 2.25 units | 1.5 × N units | 65% | 25% | 10% |
| Void Rift | Relic Tech | 1.875 units | 1.125 × N units | 45% | 35% | 20% |

Clear yields 100%; disruption yields 50%; severe yields 0 and disables exactly one of that player's participating normal drones in that sector, choosing lowest drone ID. Denied players do not suffer that sector's hazard. One shared sector outcome is sampled independently per sector before briefing and kept server-side. A hazard scan reveals that outcome, but not rivals' allocations, bids, or total supply. No drone is permanently destroyed.

### Sealed access bids and allocation

Each bid is an integer from 0–120 credits and requires at least one drone assigned to that sector. If any positive bid exists, the highest bidder alone receives extraction rights and pays its bid; tied highest bidders are selected uniformly at random by the server. Losing bids are refunded. If every bid is zero, players share the reserve in proportion to their assigned extraction capacities. For a player with capacity c in a sector with total participating capacity C and reserve R, pre-hazard yield is min(c, R × c/C). An exclusive winner instead gets min(c, R). Then multiply by the sector hazard multiplier. Unused or hazard-lost reserve is not redistributed.

This makes uncontested zero-bid extraction free of access fees. A winning bid buys access, not a guaranteed yield. All assigned drones consume their deployment credits and fuel even when excluded.

Recovery protection: eligible emergency drones can use only the Crystal Belt. Reserve 1.5 pre-hazard Alloy units for each deployed emergency drone before applying normal bids and proportional allocation to the remaining Belt reserve. These emergency units cannot be denied by exclusive rights. They still receive the Belt's shared hazard multiplier, count toward actual extracted supply, and create no additional reserve. Thus the normal-allocation R above is the reserve after protected emergency capacity is deducted, and C excludes emergency drones.

## Scans, insurance, and recovery

| Item | Exact effect / cost |
|---|---|
| Private scan | 20 credits; choose one sector's pre-sampled outcome OR this round's upcoming event for one commodity |
| Scanner upgrade | 70 credits once; future scans cost 10; no terminal resale value |
| Scan limit | 2 distinct targets per player per round; upgrades do not change limit |
| Insurance | 12 credits per named drone for the next round; if severe hazard disables it, repair it automatically after resolution; no cash payout |
| Emergency drone | When no normal mission is affordable, provide one temporary, free, zero-book-value drone; protected Belt-only capacity of 1.5 Alloys, zero fuel/deployment cost, no positive bids, no insurance, no persistent damage |

“No normal mission is affordable” means the player either has no functional normal drone and cannot fund a repair or purchase plus a Belt launch, or has a functional drone but cannot fund a Belt launch. Assess affordability using credits plus commodity/stock liquidation value after fees, and owned fuel. Evaluate after an optional briefing repair/purchase, which is allowed only for this recovery check. The temporary drone disappears as soon as normal deployment is affordable; the player can never use it alongside normal drones. It occupies no owned fleet slot, creates no credits, and never cancels previous losses. It may earn salvage and complete contracts normally.

## Trading and settlement

| Constraint | Exact rule |
|---|---|
| Fee | 2% of notional on both purchases and sales |
| Company stock base price | 100 credits for each of the three stocks |
| Company stock bounds | 25–400 credits each |
| Stock position limit | 6 shares per company per player |
| Stock order limit | At most 2 shares per company per round |
| Commodity order limit | Alloys 4; Power Cores 2; Relic Tech 1 unit per commodity per round |
| Commodity bought-position limit | A buy cannot raise owned inventory above 20 Alloys / 12 Cores / 8 Relics; extraction can exceed these limits, and excess can be held or sold |
| Order direction | One signed net order per asset per round; no simultaneous buy and sell for the same asset |
| Excluded | No short selling, borrowing, leverage, or player-to-player transfers |

Orders execute at published opening prices after all players lock and before extraction. Thus a player cannot sell newly extracted cargo until the next round. Sales use only inventory/shares already owned at lock. Buys, maximum possible winning bids, and deployment costs must fit available credits without assuming sale proceeds or losing-bid refunds. Fuel and sell quantities are reserved too. Scans are paid immediately before lock. The server rejects over-budget plans as a whole; valid orders fill completely against the public market maker, within the above limits. This gives no player a timing advantage. Final unsold cargo and shares are marked to the final price without a forced sale or extra fee.

## Exact commodity price formula

Let P be opening price, P0 base price, Q total actual extraction, B total player purchases, S total player sales, and N the number of players. All quantities refer to the same commodity and round.

1. Public demand D = N × neutral demand × demand multiplier. Sample demand multiplier independently per commodity each briefing: 0.8 (25%), 1.0 (50%), or 1.2 (25%). Show the realized demand and probability table.
2. Supply/demand signal = 0.12 × clamp((D − Q)/D, −1, 1).
3. Trading signal = 0.04 × clamp((B − S)/D, −1, 1).
4. Base-price pull = 0.06 × (P0/P − 1).
5. Event E is independently pre-sampled per commodity: −0.08 (20%), 0 (60%), +0.08 (20%). Reveal during market update; scans can reveal one earlier. Show these probabilities during briefing.
6. Change r = clamp(supply/demand signal + trading signal + base-price pull + E, −0.25, +0.25).
7. New price = clamp(round_cent(P × (1 + r)), max(price floor, ceil_cent(0.75 × P)), min(price ceiling, floor_cent(1.25 × P))). The inward cent bounds ensure rounding cannot exceed the ±25% limit.

All input and output values, including any clipping, must be displayed after reveal. B and S exclude contracts. Q includes salvage later sold or delivered. The capped trading contribution is only ±4 percentage points; extraction, demand, and events remain separate inputs. All other players' planned inputs remain hidden until reveal.

## Company profitability and stock prices

These are three fictional operating companies. Their modeled production responds to sector activity; players own shares rather than ownership rights in their salvage. Modeled company output is a price input only: it creates no extra player cargo and is not added to commodity Q.

| Company | Linked commodity | Background output / player b | Unit production cost c | Fixed cost / player f | Baseline profit / player π0 |
|---|---|---:|---:|---:|---:|
| Ferrum Industries | Alloys | 2.25 | 14 | 6 | 27.75 |
| Helion Energy | Power Cores | 1.5 | 25 | 5 | 33.25 |
| Aether Research | Relic Tech | 0.75 | 44 | 4 | 27.50 |

For each company after the commodity update:

- Modeled output per player O = b + 0.5 × Q/N.
- Profit per player π = O × updated commodity price − O × c − f.
- Baseline π0 = 1.5 × b × (commodity base price − c) − f, as tabulated.
- Profit signal = 0.35 × clamp((π − π0)/max(20, |π0|), −1.5, 1.5).
- Share-order signal = 0.02 × clamp((shares bought − shares sold)/(2 × N), −1, 1).
- Base-price pull = 0.04 × (100/current stock price − 1).
- Stock return = clamp(profit signal + share-order signal + base-price pull, −0.25, +0.25).
- New stock price = clamp(round_cent(current stock price × (1 + stock return)), max(25, ceil_cent(0.75 × current stock price)), min(400, floor_cent(1.25 × current stock price))).

No additional stock-only random roll or dividend. Company risk comes from its commodity price and output. More extraction can increase output while depressing the sale price, so stock and commodity moves need not have the same sign. Price limits apply to both markets. Show output, revenue, production cost, fixed cost, profit, and each price contribution.

## Contracts, secret objectives, and score

Every player receives the same three optional delivery contracts for the entire match. Each can be completed once, automatically after a resolution if the player requested delivery and holds the full quantity after extraction. These requests are part of the hidden plan. They can use traded or extracted cargo. Delivered cargo is removed permanently.

| Contract | Required cargo | Permanent completed-contract score |
|---|---|---:|
| Hull restoration | 6 Alloys | 165 credits |
| Reactor restart | 3 Power Cores | 145 credits |
| Archive recovery | 2 Relic Tech | 165 credits |

Completed contracts add score, not spendable credits, so the same reward is never counted twice. Contract value is fixed; the preview shows current cargo opportunity cost. Contracts have no deadline before the final resolution and no repeatable issuance.

Assign one distinct secret objective per player, uniformly without replacement. Reveal at game end. Private live scores include earned objective bonus; public player scores exclude it and are labeled accordingly until final reveal.

| Objective | Exact earned bonus, maximum 120 credits |
|---|---|
| Industrial Titan | min(120, 5 × cumulative Alloys personally extracted) |
| Market Shark | min(120, 0.30 × max(0, net investment profit)) |
| Tech Pioneer | min(120, 20 × cumulative Relic Tech personally extracted) |
| Logistics Empire | min(120, 40 × completed contract count) |

Investment profit covers stocks only: cumulative net sale proceeds plus current holdings' market value minus cumulative purchase outlay, including all trading fees. Losses across all stocks offset gains. It does not include cargo or exploitation of cost-basis resets.

Net worth = credits + stocks at current prices + unsold cargo at current prices + completed-contract score + depreciated fleet value + earned objective bonus. Display all six components at all times for the player's own corporation. No score for fuel, scanners, or unused insurance. Highest score after round 6 wins; exact ties are shared wins. Intended winning-score range is 1,500–2,400 credits, so the 120-credit maximum objective bonus is approximately 5–8%; this is a tuning target to measure in Sprint 2, not a result.

## Preview and phase order

The Market-Impact Preview uses the exact commodity formula with the player's planned orders and estimated extraction. Default competing expected extraction is (N−1) × neutral demand, with a visible control from 0 to 2× that estimate. Competing net trade defaults to 0. Unscanned event expectation is 0. Use known hazard outcomes after a scan, otherwise expected hazard multipliers: Belt 0.925, Cruiser 0.775, Rift 0.625. With estimated total competing sector capacity (N−1) × neutral demand / sector hazard multiplier, estimate proportional allocation using the actual reserve rule; winning bids remain uncertain and are shown as access-won/access-lost scenarios. Show current and projected price, personal and total estimated extraction, projected salvage value, costs, and contract opportunity cost. Label all projections as estimates, not guaranteed returns or statistically validated confidence intervals.

Server order: prepare independent hidden sector/event rolls → public briefing and private scans → simultaneous sealed plans → execute reserved opening-price orders and deduct deployment/fuel → resolve access bids → apply hazards and add cargo → update commodity prices → calculate profits and update stocks → fulfill requested contracts → apply insurance and depreciation → score breakdown and public reveal → upgrades → next briefing. Round 6 goes directly from reveal to final standings. Show an outcome log and require every player to acknowledge upgrades/reveal before advancing.

## Simulation acceptance criteria and evidence

The simulator runs reproducible four-player matches with heavy extractor, safe hauler, scanner-heavy, pure trader, and random strategies, rotating seats, objectives, and opponent compositions. The main benchmark includes every choice of four distinct policies. A separate stress suite includes all 70 four-seat policy multisets, including duplicates. Policy win rate is measured per occupied seat with split ties. The approximately 40% target applies to aggregate strategy performance in these benchmark fields; individual counter-matchups can exceed it and are reported explicitly. See BALANCE_REPORT.md and simulation/results/final-*.json for sample sizes, confidence intervals, wealth, price bounds, recovery, objective contribution, and exploit probes. Two- and three-player balance is reported separately. No human, multiplayer networking, or browser-session testing has occurred in this sprint.

## Changes from v0.1

- Reduced each sector's per-drone capacity and reserve by 25%, so free extraction does not overwhelm investing.
- Increased drone purchase/book value from 180 to 260, making rapid fleet expansion a more consequential investment.
- Increased stock profitability sensitivity from 0.10 to 0.35, retaining the same ±25% cap, fees, position limits, and separate commodity formula.
- Reduced neutral Alloy demand from 3 to 2.25 per player to match the reduced reserve. This preserves actual supply gluts: with four players, low demand is 7.2 Alloys, and extracting the 9-unit reserve lowers the supply/demand contribution by 3 percentage points.
- Protected emergency Belt capacity against exclusive bids, preserving the ability to rebuild without gifting credits or erasing losses.
- Clarified price rounding so the advertised change cap holds exactly at cent precision.

Future expansions only: sabotage cards, short selling, and loans.
