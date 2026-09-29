import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'apps/desktop/native-build');mkdirSync(output,{recursive:true,mode:0o700});
if(process.platform==='win32') {
  process.stdout.write('POSIX safe file helper unavailable on Windows; file operations fail closed.\n');
} else {
  const result=spawnSync('/usr/bin/cc',['-std=c11','-D_GNU_SOURCE','-O2','-Wall','-Wextra','-Werror',
    '-Wno-deprecated-declarations',resolve(root,'apps/desktop/native/safe-files-posix.c'),
    '-o',resolve(output,'safe-files'),...(process.platform==='linux'?['-lcrypto']:[])],{shell:false,stdio:'inherit'});
  if(result.error || result.status!==0) process.exit(1);
}
