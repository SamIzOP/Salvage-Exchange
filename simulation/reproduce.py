"""Reproduce the frozen validation suite. Run from the workspace root."""
import json
from pathlib import Path
from economy import Rules,play
from run import tournament

SUITES=[
    ('distinct',2000,20401027,'final-holdout.json'),
    ('duplicates',200,20411027,'final-duplicates.json'),
    ('adversarial',150,20421027,'final-adversarial.json'),
    ('scan_ablation',300,20431027,'final-scan-ablation.json'),
    ('two_player',200,20441027,'final-two-player.json'),
    ('three_player',200,20451027,'final-three-player.json'),
]

if __name__ == '__main__':
    r=Rules.from_dict(json.loads(Path('simulation/rules-v0.2.json').read_text()))
    for suite,games,seed,name in SUITES:
        result=tournament(r,games,seed,suite)
        Path('simulation/results',name).write_text(json.dumps(result,indent=2)+'\n')
        print(f'{suite}: {result["games"]} matches complete',flush=True)
