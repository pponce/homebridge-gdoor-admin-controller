import {spawn} from 'node:child_process';
import {appendFile,readdir} from 'node:fs/promises';
const files=(await readdir('test')).filter(x=>x.endsWith('.test.js')).map(x=>'test/'+x);
const child=spawn(process.execPath,['--test','--test-reporter=tap',...files],{stdio:['ignore','pipe','pipe']});let output='';
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output+=data;process.stdout.write(data);});
child.on('exit',async code=>{if(code&&process.env.GITHUB_OUTPUT){const blocks=output.split(/(?=not ok )/).slice(1).map(v=>v.split(/\n(?:# Subtest:|ok \d)/)[0]);await appendFile(process.env.GITHUB_OUTPUT,'result='+blocks.join(' ').replaceAll('\n',' ').slice(0,1500)+'\n');}process.exitCode=code??1;});
