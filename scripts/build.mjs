import {mkdir, readdir, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'web'), destination=join(root,'dist');
await mkdir(destination,{recursive:true});
for(const file of await readdir(source)) {
  if(file.endsWith('.js')) execFileSync(process.execPath,['--check',join(source,file)],{stdio:'inherit'});
  if(/\.(html|css|js|svg)$/.test(file)) await copyFile(join(source,file),join(destination,file));
}
console.log('Built browser assets in dist/; JavaScript syntax checks passed.');
