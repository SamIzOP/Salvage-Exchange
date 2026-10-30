import {mkdir, readdir, copyFile, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'web'), destination=join(root,'dist');
async function copy(from, to) {
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})) {
    const file=entry.name;
    if(entry.isDirectory()) {await copy(join(from,file),join(to,file));continue;}
    if(file.endsWith('.js')) execFileSync(process.execPath,['--check',join(from,file)],{stdio:'inherit'});
    if(/\.(html|css|js|svg|woff2|txt)$/.test(file)) await copyFile(join(from,file),join(to,file));
  }
}
await copy(source,destination);
// The practice round runs the same engine as the Worker server in the browser.
const engine=join(destination,'engine');
await mkdir(engine,{recursive:true});
for(const file of ['economy.js','schema.js','game.js']) await copyFile(join(root,'worker/src',file),join(engine,file));
const rules=JSON.parse(await readFile(join(root,'simulation/rules-v0.2.json'),'utf8'));
await writeFile(join(engine,'rules.js'),`// Generated from simulation/rules-v0.2.json by scripts/build.mjs.\nexport default ${JSON.stringify(rules)};\n`);
console.log('Built browser assets in dist/; JavaScript syntax checks passed.');
