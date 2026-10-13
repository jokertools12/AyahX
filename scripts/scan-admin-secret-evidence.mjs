/** Root-only exact-secret scan. Private input values never leave memory. */
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,basename} from 'node:path';
const privateRoot=join(process.env.LOCALAPPDATA,'AyahX','private-backups');
const secrets=new Set();
function collect(value,key=''){if(value&&typeof value==='object'){for(const [name,item]of Object.entries(value))collect(item,name);}else if(typeof value==='string'&&value.length>=12&&/^(?:secret|password|cookie|token|jwt|totp|access_?key(?:_?id)?|secret_?access_?key|key)$/iu.test(key)){secrets.add(value);}}
const names=(await readdir(privateRoot)).filter(name=>/\.json$/u.test(name)&&/(?:fixture|runtime|totp-key|r2|credential|qa)/iu.test(name));
for(const name of names)collect(JSON.parse(await readFile(join(privateRoot,name),'utf8')));
// Native CI accounts live in private per-run fixture folders, not root JSON.
// Include their passwords and the production QA lifecycle credential explicitly.
for(const entry of await readdir(privateRoot,{withFileTypes:true}))if(entry.isDirectory()&&/^batch5-ci(?:-|$)/u.test(entry.name)){
 try{collect(JSON.parse(await readFile(join(privateRoot,entry.name,'fixture.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
}
try{const env=await readFile('.env','utf8');for(const line of env.split(/\r?\n/u)){const match=line.match(/^([A-Z0-9_]+)\s*=\s*(.*?)\s*$/u);if(match&&/(?:KEY|SECRET|TOKEN|PASSWORD|URL)/u.test(match[1])&&match[2].length>=16)secrets.add(match[2].replace(/^['"]|['"]$/gu,''));}}catch(error){if(error.code!=='ENOENT')throw error;}
if(!secrets.size)throw new Error('KNOWN_PRIVATE_SECRETS_REQUIRED');
const listed=spawnSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'});if(listed.status!==0)throw new Error('GIT_FILE_LIST_FAILED');
const files=[...new Set(listed.stdout.trim().split(/\r?\n/u))].filter(name=>!name.endsWith('.tmp.ts')&&/\.(?:md|json|[cm]?js|jsx|tsx?|yml|yaml|html|css|sql)$/u.test(name));
const baseline='d1c0a1c7838b826a12969d7581171ae9701486d6',leaks=[],preExisting=[];for(const name of files){const text=await readFile(name,'utf8'),matches=[...secrets].filter(secret=>text.includes(secret));if(!matches.length)continue;const old=spawnSync('git',['show',`${baseline}:${name}`],{encoding:'utf8',maxBuffer:16*1024*1024});if(old.status===0&&matches.every(secret=>old.stdout.includes(secret)))preExisting.push(name);else leaks.push(name);}
const extra=process.argv.indexOf('--private-log');let logs=0;if(extra>=0){const path=process.argv[extra+1];if(!path)throw new Error('LOG_PATH_REQUIRED');const text=await readFile(path,'utf8');logs++;if([...secrets].some(secret=>text.includes(secret)))leaks.push('private-runtime-log:'+basename(path));}
const report={observed_at:new Date().toISOString(),method:'Exact known private credential values against tracked and eligible untracked text; unchanged exact matches from the pre-batch baseline are recorded separately; values and private source paths never printed',baseline,known_secret_count:secrets.size,text_files_checked:files.length,additional_logs_checked:logs,pre_existing_exact_matches:preExisting,leaked_files:leaks,passed:leaks.length===0};
await writeFile('docs/data/a1-secret-scan.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(leaks.length)process.exitCode=1;
