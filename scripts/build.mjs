import {mkdir, readdir, copyFile} from 'node:fs/promises';
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
console.log('Built browser assets in dist/; JavaScript syntax checks passed.');
