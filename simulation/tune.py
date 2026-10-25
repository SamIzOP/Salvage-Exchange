"""Exploratory parameter sweep; holdout seeds are reserved for final validation."""
from dataclasses import asdict,replace
import json
from pathlib import Path
from economy import Rules
from run import tournament

base=Rules()
candidates=[('baseline',base)]
for scale in [.65,.80,1.0]:
    for minimum in [10,20]:
        for profit in [.10,.20]:
            name=f'yield{scale}-bid{minimum}-profit{profit}'
            r=replace(base,version=name,capacity=tuple(x*scale for x in base.capacity),
                reserve=tuple(x*scale for x in base.reserve),bid_min=minimum,stock_profit_signal=profit)
            candidates.append((name,r))
results=[]
for name,r in candidates:
    result=tournament(r,100,seed=702001)
    worst=max(v['win_rate'] for group in result['lineups'] for v in group['policies'].values())
    results.append(dict(name=name,worst_lineup_rate=worst,result=result))
    print(name, 'worst',round(worst,3),{p:round(a['win_rate'],3) for p,a in result['policies'].items()},flush=True)
Path('simulation/results/tuning.json').write_text(json.dumps(results,indent=2)+'\n')
