"""Reproducible tournament runner. No external packages or network required."""
import argparse
from collections import defaultdict
from dataclasses import asdict
import itertools
import json
import math
import hashlib
from pathlib import Path
import statistics

from economy import POLICIES, Rules, play


def percentile(values, q):
    values = sorted(values)
    return values[round((len(values)-1)*q)] if values else None


def wilson(wins, n):
    if not n:
        return [0,1]
    p, z = wins/n, 1.96
    center = (p+z*z/(2*n))/(1+z*z/n)
    spread = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    return [round(center-spread, 5), round(center+spread, 5)]


def tournament(r, games_per_lineup, seed=20261025, suite='distinct'):
    if suite == 'distinct':
        lineups = list(itertools.combinations(POLICIES,4))
    elif suite == 'duplicates':
        lineups = list(itertools.combinations_with_replacement(POLICIES,4))
    elif suite == 'adversarial':
        lineups = [(attack, *others) for attack in ('one_credit_raider','bid_monopolist','hoarder','pump_trader')
                   for others in itertools.combinations(POLICIES,3)]
    elif suite == 'scan_ablation':
        lineups = [('scanner_heavy','scanner_no_scan',a,b) for a,b in itertools.combinations(
            ('heavy_extractor','safe_hauler','pure_trader','random'),2)]
    elif suite == 'two_player':
        lineups = list(itertools.combinations(POLICIES,2))
    elif suite == 'three_player':
        lineups = list(itertools.combinations(POLICIES,3))
    else:
        raise ValueError(suite)
    aggregate = defaultdict(lambda:dict(seats=0,wins=0.,scores=[],bonuses=[],scan_spend=[],bid_spend=[]))
    groups, allscores, winning, objective_ratios = [], [], [], []
    recovery, mincredits, maxwealth, maxprice, scans = 0, 750., 0., 1., 0
    seat_wins = [0.]*len(lineups[0])
    objective_wins = [0.]*4
    objective_seats = [0]*4
    for group,lineup in enumerate(lineups):
        counts = defaultdict(lambda:[0.,0])
        for k in range(games_per_lineup):
            result = play(seed+group*1000003+k,lineup,r)
            allscores.extend(result['scores'])
            winning.append(max(result['scores']))
            m = result['metrics']
            recovery += m['recovery']
            scans += m['scans']
            mincredits = min(mincredits,m['mincredits'])
            maxwealth = max(maxwealth,m['maxwealth'])
            maxprice = max(maxprice,m['maxprice_ratio'])
            for i,policy in enumerate(result['policies']):
                a = aggregate[policy]
                a['seats'] += 1
                a['wins'] += result['wins'][i]
                for key,source in [('scores','scores'),('bonuses','bonuses'),('scan_spend','scan_spend'),('bid_spend','bid_spend')]:
                    a[key].append(result[source][i])
                counts[policy][0] += result['wins'][i]
                counts[policy][1] += 1
                seat_wins[i] += result['wins'][i]
                obj = result['objectives'][i]
                objective_wins[obj] += result['wins'][i]
                objective_seats[obj] += 1
                if result['wins'][i]:
                    objective_ratios.append(result['bonuses'][i]/result['scores'][i])
        groups.append(dict(lineup=lineup, games=games_per_lineup,
            policies={p:dict(win_rate=round(w/n,5), seats=n, ci95=wilson(w,n)) for p,(w,n) in counts.items()}))
    summary = {}
    for policy,a in aggregate.items():
        summary[policy] = dict(seats=a['seats'], win_rate=round(a['wins']/a['seats'],5),
            ci95=wilson(a['wins'],a['seats']), mean_score=round(statistics.mean(a['scores']),2),
            score_p05=percentile(a['scores'],.05), score_p95=percentile(a['scores'],.95),
            mean_bonus=round(statistics.mean(a['bonuses']),2), mean_scan_spend=round(statistics.mean(a['scan_spend']),2),
            mean_bid_spend=round(statistics.mean(a['bid_spend']),2))
    total = len(lineups)*games_per_lineup
    return dict(rules=asdict(r),suite=suite, seed=seed, games=total,
        policy_revision='v2: cautious bidder uses same bid-value ceiling as extractor; no random insurance',
        model_sha256=hashlib.sha256(Path(__file__).with_name('economy.py').read_bytes()).hexdigest(),
        policies=summary,lineups=groups,
        metrics=dict(score_min=min(allscores),score_median=percentile(allscores,.5),score_p95=percentile(allscores,.95),
            score_p99=percentile(allscores,.99),score_max=max(allscores),winner_median=percentile(winning,.5),
            winner_p05=percentile(winning,.05),winner_p95=percentile(winning,.95),maxwealth_any_round=maxwealth,
            recovery_deployments=recovery,mincredits=mincredits,max_price_multiple=maxprice,scans=scans,
            mean_winner_objective_fraction=round(statistics.mean(objective_ratios),5),
            seat_win_rates=[round(x/total,5) for x in seat_wins],
            objective_win_rates=[round(w/n,5) if n else 0 for w,n in zip(objective_wins,objective_seats)]))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--rules')
    parser.add_argument('--games',type=int,default=1000,help='Games per lineup')
    parser.add_argument('--seed',type=int,default=20261025)
    parser.add_argument('--suite',default='distinct')
    parser.add_argument('--out',required=True)
    args = parser.parse_args()
    rules = Rules.from_dict(json.loads(Path(args.rules).read_text())) if args.rules else Rules()
    result = tournament(rules,args.games,args.seed,args.suite)
    path = Path(args.out)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('games','policies','metrics')},indent=2))
