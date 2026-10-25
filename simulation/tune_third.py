from dataclasses import replace
import itertools,json
from pathlib import Path
from economy import Rules
from run import tournament

results=[]
for scan,scale,drone,profit in itertools.product([25,30,35],[.8,1.0],[180,260],[.10,.25]):
    name=f'v2-scan{scan}-yield{scale}-drone{drone}-profit{profit}'
    b=Rules()
    r=replace(b,version=name,scan_cost=scan,upgraded_scan_cost=scan-10,
              capacity=tuple(x*scale for x in b.capacity),reserve=tuple(x*scale for x in b.reserve),
              drone_cost=drone,stock_profit_signal=profit)
    result=tournament(r,100,seed=702001)
    worst=max(v['win_rate'] for group in result['lineups'] for v in group['policies'].values())
    results.append(dict(name=name,worst_lineup_rate=worst,result=result))
    print(name,'worst',round(worst,3),{p:round(a['win_rate'],3) for p,a in result['policies'].items()},flush=True)
Path('simulation/results/tuning-third.json').write_text(json.dumps(results,indent=2)+'\n')
