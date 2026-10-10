/** Compare changed-file diagnostics with their exact baseline source lines; never fixes files. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const option=key=>{const i=process.argv.indexOf(key);return i<0?null:process.argv[i+1];};
const base=option('--base')??'main',reportPath=option('--report');
const git=args=>spawnSync('git',args,{encoding:'utf8',maxBuffer:16*1024*1024});
if(git(['rev-parse','--verify',base]).status!==0)throw new Error('LINT_BASE_REQUIRED');
const changed=git(['diff','--name-only','--diff-filter=ACMR',base,'--']).stdout.trim().split(/\r?\n/u);
const untracked=process.argv.includes('--include-untracked')?git(['ls-files','--others','--exclude-standard']).stdout.trim().split(/\r?\n/u):[];
const files=[...new Set([...changed,...untracked])].filter(f=>/\.(?:[cm]?js|jsx|tsx?)$/u.test(f)&&!f.endsWith('.tmp.ts'));
const eslint=(args,input)=>{const r=spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js',...args],{encoding:'utf8',input,maxBuffer:32*1024*1024});if(![0,1].includes(r.status))throw new Error('CHANGED_LINT_TOOL_FAILED');return JSON.parse(r.stdout);};
const diagnostics=files.length?eslint(['--format','json',...files]):[];
const signature=(m,source)=>JSON.stringify([m.ruleId,m.severity,m.message,source.split(/\r?\n/u)[m.line-1]?.trim()??'']);
const baselineCounts=new Map(),newMessages=[],existingMessages=[];
for(const result of diagnostics){
  const file=files.find(f=>resolve(f)===result.filePath);if(!file)throw new Error('CHANGED_LINT_RESULT_UNKNOWN');
  const source=readFileSync(file,'utf8'),previous=git(['show',base+':'+file]);
  const old=previous.status===0&&result.messages.length?eslint(['--stdin','--stdin-filename',file,'--format','json'],previous.stdout)[0].messages:[];
  baselineCounts.clear();for(const m of old){const key=signature(m,previous.stdout);baselineCounts.set(key,(baselineCounts.get(key)??0)+1);}
  for(const message of result.messages){const key=signature(message,source),n=baselineCounts.get(key)??0;const item={file,rule:message.ruleId,severity:message.severity,line:message.line,message:message.message};if(n){existingMessages.push(item);baselineCounts.set(key,n-1);}else newMessages.push(item);}
}
const report={checked_at:new Date().toISOString(),base,files:files.length,new_messages:newMessages,existing_messages:existingMessages,passed:newMessages.length===0};
if(reportPath)writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
