from dataclasses import replace
import itertools,json
from pathlib import Path
from economy import Rules
from run import tournament

results=[]
for scan,belt,drone,profit in itertools.product([30,45,60],[4,5],[180,260],[.10,.25]):
    name=f'scan{scan}-belt{belt}-drone{drone}-profit{profit}'
    r=replace(Rules(),version=name,scan_cost=scan,upgraded_scan_cost=scan-10,
              capacity=(belt,3.,2.5),reserve=(belt*.75,2.,1.5),
              demand=(belt*.75,1.5,.75),drone_cost=drone,stock_profit_signal=profit)
    result=tournament(r,100,seed=702001)
    worst=max(v['win_rate'] for group in result['lineups'] for v in group['policies'].values())
    results.append(dict(name=name,worst_lineup_rate=worst,result=result))
    print(name,'worst',round(worst,3),{p:round(a['win_rate'],3) for p,a in result['policies'].items()},flush=True)
Path('simulation/results/tuning-second.json').write_text(json.dumps(results,indent=2)+'\n')
