from dataclasses import replace,asdict
import json
from pathlib import Path
from economy import Rules

b=Rules()
r=replace(b,version='0.2-candidate',capacity=(3.,2.25,1.875),reserve=(2.25,1.5,1.125),
          drone_cost=260.,stock_profit_signal=.35,protected_recovery=True)
Path('simulation/candidate.json').write_text(json.dumps(asdict(r),indent=2)+'\n')
