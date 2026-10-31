import {mkdir, readdir, copyFile, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'web'), destination=join(root,'dist');

// web/engine/rules.js is the frozen rules file as a browser module, so any host that serves web/
// (or packages it, like a Sites adapter) can run practice. Keep it in step with the JSON.
const rules=JSON.parse(await readFile(join(root,'simulation/rules-v0.2.json'),'utf8'));
const rulesModule=`// Generated from simulation/rules-v0.2.json by scripts/build.mjs. Do not edit.\nexport default ${JSON.stringify(rules)};\n`;
const rulesPath=join(source,'engine/rules.js');
if((await readFile(rulesPath,'utf8').catch(()=>''))!==rulesModule) { await writeFile(rulesPath,rulesModule); console.log('Regenerated web/engine/rules.js.'); }

async function copy(from, to) {
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})) {
    const file=entry.name;
    if(entry.isDirectory()) {await copy(join(from,file),join(to,file));continue;}
    if(file.endsWith('.js')) execFileSync(process.execPath,['--check',join(from,file)],{stdio:'inherit'});
    if(/\.(html|css|js|svg|woff2|txt)$/.test(file)) await copyFile(join(from,file),join(to,file));
  }
}
// Start clean so files removed from web/ never linger in a deployed build.
await rm(destination,{recursive:true,force:true});
await copy(source,destination);
console.log('Built browser assets in dist/; JavaScript syntax checks passed.');
