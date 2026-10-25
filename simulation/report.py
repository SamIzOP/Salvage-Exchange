"""Verify saved evidence and generate the human-readable sprint deliverable."""
import hashlib
import io
import json
from pathlib import Path
import unittest

from economy import Rules,POLICIES,play,commodity_update,money
from reproduce import SUITES
import test_economy

root=Path('simulation')
params=json.loads((root/'rules-v0.2.json').read_text())
r=Rules.from_dict(params)
model_hash=hashlib.sha256((root/'economy.py').read_bytes()).hexdigest()
data={}
for suite,games,seed,name in SUITES:
    d=json.loads((root/'results'/name).read_text())
    assert d['rules']==params,(name,'rules mismatch')
    assert d['model_sha256']==model_hash,(name,'stale model')
    assert d['seed']==seed,(name,'seed mismatch')
    assert all(g['games']==games for g in d['lineups'])
    assert sum(g['games'] for g in d['lineups'])==d['games']
    data[suite]=d

output=io.StringIO()
test_result=unittest.TextTestRunner(stream=output,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(test_economy))
(root/'results'/'test-results.txt').write_text(output.getvalue(),encoding='utf-8')
assert test_result.wasSuccessful(),output.getvalue()

main=data['distinct']
dup=data['duplicates']
adv=data['adversarial']
baseline=json.loads((root/'results'/'baseline-policy-v2.json').read_text())
worst=max((v['win_rate'],g['lineup'],p,v['ci95']) for g in main['lineups'] for p,v in g['policies'].items())
duplicate_worst=max((v['win_rate'],g['lineup'],p) for g in dup['lineups'] for p,v in g['policies'].items())
assert all(p['win_rate'] < .4 for p in main['policies'].values())
assert worst[0] < .4
assert all(p['win_rate'] < .4 for p in dup['policies'].values())

def pct(x):
    return f'{100*x:.2f}%'

def label(p):
    return p.replace('_',' ').title()

rows=[]
for p in POLICIES:
    a=main['policies'][p]
    rows.append(f'| {label(p)} | {pct(baseline["policies"][p]["win_rate"])} | {pct(a["win_rate"])} | {pct(a["ci95"][0])}–{pct(a["ci95"][1])} | {a["mean_score"]:,.2f} | {pct(dup["policies"][p]["win_rate"])} |')
lineup_rows=[]
for g in main['lineups']:
    lineup_rows.append('| '+', '.join(label(p) for p in g['lineup'])+' | '+'; '.join(f'{label(p)} {pct(g["policies"][p]["win_rate"])}' for p in g['lineup'])+' |')
attack_rows=[]
for p in ('one_credit_raider','bid_monopolist','hoarder','pump_trader'):
    attack_rows.append(f'| {label(p)} | {adv["policies"][p]["seats"]:,} | {pct(adv["policies"][p]["win_rate"])} |')
suite_rows=[]
for suite,games,seed,name in SUITES:
    suite_rows.append(f'| {suite} | {data[suite]["games"]:,} | {len(data[suite]["lineups"])} | {seed} | simulation/results/{name} |')
m=main['metrics']
total=sum(d['games'] for d in data.values())
ab=data['scan_ablation']['policies']
maximum=max(d['metrics']['score_max'] for d in data.values())
maxprice=max(d['metrics']['max_price_multiple'] for d in data.values())
recoveries=sum(d['metrics']['recovery_deployments'] for d in data.values())

# Explicit end-mark effect probe, separate from claims about repeatable loops.
demand=[4*x for x in r.demand]
without,_=commodity_update(list(r.base),demand,[0,0,0],demand,[0,0,0],r)
with_buy,_=commodity_update(list(r.base),demand,[4,0,0],demand,[0,0,0],r)
terminal_mark_gain=money(20*with_buy[0]-4*r.base[0]*(1+r.fee)-16*without[0])
probe=dict(description='Isolated neutral-price, 16-Alloy holder buys 4 Alloys at opening quote; compare final marked cargo minus purchase cost.',
    without_trade_price=without[0],with_trade_price=with_buy[0],incremental_marked_score=terminal_mark_gain,
    note='Illustrates a bounded mark-to-market incentive; not a risk-free liquidation profit or a proof of global optimality.')
(root/'results'/'terminal-mark-probe.json').write_text(json.dumps(probe,indent=2)+'\n')

text=f'''# SALVAGE EXCHANGE — Sprint 2 simulation report

Date: 25 October 2026 (Asia/Karachi). Frozen economy: v0.2.

The four-player mixed-strategy benchmark meets the requested approximately 40% ceiling: the highest aggregate rate is {pct(max(a['win_rate'] for a in main['policies'].values()))}, and the highest rate in any of the five four-distinct-strategy lineups is {pct(worst[0])}. This is evidence about the specified bots and opponent fields, not proof that every possible matchup is balanced. Duplicate-strategy stress tests expose strong counters, detailed below. The full game, browser testing, and deployment remain Steps 3–5.

## What ran

{total:,} complete six-round matches using the frozen rules, in addition to baseline and tuning experiments. The principal holdout contains {main['games']:,} matches: 2,000 for each of the five possible four-distinct-policy lineups. Every policy appears in 8,000 matches. Seats and the four distinct secret objectives are shuffled independently of policy choices. Tied winners share the win. The final holdout seeds were not used for parameter selection.

| Suite | Matches | Lineups | Seed | Raw evidence |
|---|---:|---:|---:|---|
{chr(10).join(suite_rows)}

All final result files match the current rules JSON and economic-model SHA-256 `{model_hash}`. Result files retain the exact parameters, seeds, policy revision, and per-lineup samples. Earlier candidates and exploratory sweeps are retained separately and are excluded from the final counts.

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
{chr(10).join(rows)}

Each rate divides wins by that policy's appearances, not by all matches. These five rates therefore do not sum to 100%: each match contains four of the five policies. Equal performance would be approximately 25% per policy. Confidence intervals describe Monte Carlo uncertainty for these fixed policies, not uncertainty about human strategies. Duplicate-field intervals are not used for conclusions because seats of the same policy within a match are correlated.

| Four-distinct-policy lineup | Per-policy win rates |
|---|---|
{chr(10).join(lineup_rows)}

The highest individual-lineup rate, {pct(worst[0])}, has a Wilson interval of {pct(worst[3][0])}–{pct(worst[3][1])}. No primary-field strategy or lineup breaches 40%.

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

Primary-field median winning net worth: {m['winner_median']:,.2f} credits. The middle 90% of winning scores spans {m['winner_p05']:,.2f}–{m['winner_p95']:,.2f}. All-player median: {m['score_median']:,.2f}; 99th percentile: {m['score_p99']:,.2f}; maximum: {m['score_max']:,.2f}.

Across all {total:,} final-rules matches, the maximum observed final score was {maximum:,.2f}; the largest observed asset price was {maxprice:.4f} times its base. No reserve, price, nonnegative-credit, fuel, or stock-position assertion failed. These finite six-round samples found no runaway wealth; they are not a mathematical proof against every possible policy.

The 120-credit objective cap is {100*120/m['winner_median']:.2f}% of the median winning score, within the requested 5–10% maximum-bonus target. Actual earned bonuses averaged {pct(m['mean_winner_objective_fraction'])} of winning wealth because not every winner caps its objective. Objective-conditioned win rates were Industrial Titan {pct(m['objective_win_rates'][0])}, Market Shark {pct(m['objective_win_rates'][1])}, Tech Pioneer {pct(m['objective_win_rates'][2])}, and Logistics Empire {pct(m['objective_win_rates'][3])}. Logistics is weaker for these policies and remains a human-playtest tuning concern; this report does not claim objective parity.

## Exploits, recovery, and scan value

{test_result.testsRun} regression/invariant tests pass. They cover exact price examples, company profitability, price caps after rounding, allocation/reserve conservation, bid ties and payment, deployment costs for denied bids, fuel, hazards, insurance, depreciation, fee round trips, all-bid cash reservation, blocked short sales and future-sale financing, position/order limits, contract consumption and one-time rewards, investment-loss offsets, objective caps, scan budgets, recovery eligibility, and deterministic replay. A separate 10,000-transition price stress test is included in this count.

| Attack policy | Appearances | Win rate against three distinct standard policies |
|---|---:|---:|
{chr(10).join(attack_rows)}

The four attacks are fixed-minimum bidding across sectors; aggressive bids up to half estimated gross yield; holding starting cash and fleet idle; and concentrating purchases into one stock to maximize its own order pressure. No attack exceeded 40% in aggregate. This is a targeted probe set, not an exhaustive search over adaptive adversaries or collusion.

The blocked-recovery exploit was real in v0.1: exclusive rights could deny a bankrupt player every yield. v0.2 reserves emergency Belt capacity before auction allocation, without increasing the sector reserve. Tests force a broke player through protected salvage, selling, repairing, refueling, and a valid normal mission; losses and damaged fleet are not reset. Recovery drones appeared {recoveries} times in the final stochastic suite, so forced scenarios provide stronger coverage than the rare natural cases.

Own-order pressure alone cannot pay for a buy-then-sell fee loop at the tested maximum orders: the commodity pressure cap is 4%, below the 4.0816% rise needed to cover two 2% fees; stock pressure is capped at 2%. The model also enforces one net order per asset per round. A bounded terminal mark-to-market incentive remains: in an isolated neutral-price probe, a player holding 16 Alloys and buying 4 improves marked score by {terminal_mark_gain:.2f} credits through its own price impact after purchase fees. This is not free liquidation profit; trading pressure is intentionally part of the market, but close-game end-mark manipulation needs human playtesting. See terminal-mark-probe.json.

In {data['scan_ablation']['games']:,} matches comparing scanner-heavy play with the same allocation/bidding style without scans, the scanning policy won {pct(ab['scanner_heavy']['win_rate'])}, versus {pct(ab['scanner_no_scan']['win_rate'])} without scans. Mean scores were {ab['scanner_heavy']['mean_score']:,.2f} versus {ab['scanner_no_scan']['mean_score']:,.2f}. Their intervals overlap: buying two scans every round is not reliably profitable. A scan reveals useful information, but access competition and its cost still matter. Selective scan timing is not optimized by these bots.

## Matchup limits — do not hide behind the aggregate

The 14,000-match duplicate-policy suite spans all 70 four-seat multisets and keeps each policy's aggregate rate below 40%. Nevertheless, a single scanner-heavy extractor against three pure traders won {pct(duplicate_worst[0])} of its 200 games. Uncontested extraction strongly counters a room where everybody else refuses to mine. This violates any interpretation of “below 40%” that requires every possible opponent composition to be balanced; that stronger condition has not been achieved. The primary mixed-policy benchmark target has been achieved.

In the separate attack-insertion field, safe hauler and scanner-heavy aggregate rates are {pct(adv['policies']['safe_hauler']['win_rate'])} and {pct(adv['policies']['scanner_heavy']['win_rate'])}, respectively. Those fields include weak cash-hoarding and minimum-bid opponents. Their individual counter-matchups also exceed 40%, although the attack policies themselves do not dominate.

Two- and three-player rules execute successfully, but their strategic balance is not equivalent to four-player balance. Pure trader wins only {pct(data['two_player']['policies']['pure_trader']['win_rate'])} in the two-player field and {pct(data['three_player']['policies']['pure_trader']['win_rate'])} in the three-player field. The two-player neutral benchmark is 50%, not 25%. The game must still support these room sizes; these results are an explicit alpha limitation, not permission to remove them.

Bots are bounded heuristics. They do not optimize all contracts, selective scans, final-round insurance, opponent learning, or collusion. No human usability, 15–20 minute duration, device support, reconnect behavior, or network privacy claim follows from these simulations. Those remain implementation and testing obligations.

## Reproduce and next step

Run `python simulation/reproduce.py`, then `python simulation/report.py` from the project folder. Run `python simulation/test_economy.py` for the standalone checks. No third-party dependencies are required. The report verifies rules and source fingerprints before accepting saved results.

The user requested one process step at a time. Stop after presenting this report. Step 3 is to build the full multiplayer game using ECONOMY.md and rules-v0.2.json, retaining the limitations above for review. Do not begin it until the user says “continue”.
'''
Path('BALANCE_REPORT.md').write_text(text,encoding='utf-8')
for n in (2,3,4):
    fixture=play(9000+n,POLICIES[:n],r,trace=True)
    (root/'results'/f'replay-{n}-player.json').write_text(json.dumps(fixture,indent=2)+'\n')
summary=dict(status='primary benchmark passed; composition-specific balance limitations remain',
    matches=total,tests=test_result.testsRun,model_sha256=model_hash,
    highest_primary_win_rate=max(a['win_rate'] for a in main['policies'].values()),
    highest_distinct_lineup_rate=worst[0],highest_duplicate_lineup_rate=duplicate_worst[0],
    primary_policy_rates={p:a['win_rate'] for p,a in main['policies'].items()},
    mean_winning_objective_share=m['mean_winner_objective_fraction'],
    median_winning_score=m['winner_median'])
(root/'results'/'verification.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary,indent=2))
