from pathlib import Path
import json
import shutil

r=json.loads(Path('simulation/candidate.json').read_text())
r['version']='0.2'
r['demand'][0]=2.25
archive=Path('simulation/results/earlier-candidate')
archive.mkdir(exist_ok=True)
for path in Path('simulation/results').glob('final-*.json'):
    if not (archive/path.name).exists():
        shutil.copy2(path,archive/path.name)
Path('simulation/rules-v0.2.json').write_text(json.dumps(r,indent=2)+'\n')
