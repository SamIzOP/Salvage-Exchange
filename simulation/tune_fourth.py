from dataclasses import replace
import itertools,json
from pathlib import Path
from economy import Rules
from run import tournament

results=[]
for scan,scale,profit in itertools.product([20,25,30],[.65,.7,.75],[.25,.35]):
    name=f'v2-scan{scan}-yield{scale}-drone260-profit{profit}'
    b=Rules()
    r=replace(b,version=name,scan_cost=scan,upgraded_scan_cost=scan-10,
              capacity=tuple(x*scale for x in b.capacity),reserve=tuple(x*scale for x in b.reserve),
              drone_cost=260,stock_profit_signal=profit,protected_recovery=True)
    result=tournament(r,150,seed=702001)
    worst=max(v['win_rate'] for group in result['lineups'] for v in group['policies'].values())
    results.append(dict(name=name,worst_lineup_rate=worst,result=result))
    print(name,'worst',round(worst,3),{p:round(a['win_rate'],3) for p,a in result['policies'].items()},flush=True)
Path('simulation/results/tuning-fourth.json').write_text(json.dumps(results,indent=2)+'\n')
