from dataclasses import replace,asdict
import json
from pathlib import Path
from economy import Rules
from run import tournament

b=Rules.from_dict(json.loads(Path('simulation/rules-v0.2.json').read_text()))
results=[]
for demand in [2.25,2.5,2.7]:
    for logistics in [40,60]:
        r=replace(b,version=f'demand{demand}-logistics{logistics}',demand=(demand,1.5,.75),logistics_rate=logistics)
        result=tournament(r,500,seed=705000)
        worst=max(v['win_rate'] for g in result['lineups'] for v in g['policies'].values())
        print(r.version,'worst',worst,{p:v['win_rate'] for p,v in result['policies'].items()},
              'objective',result['metrics']['objective_win_rates'],flush=True)
        results.append(result)
Path('simulation/results/demand-check.json').write_text(json.dumps(results,indent=2)+'\n')
