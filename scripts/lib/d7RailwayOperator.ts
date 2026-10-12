/** Root-only transport for existing approved production app/Skia services. */
import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
export class D7OperatorError extends Error {
 constructor(code:number|null,public readonly stdout:string,public readonly diagnosticHash:string,public readonly safeDiagnostic:string|null){super('D7_OPERATOR_SSH_EXIT_'+code);Object.defineProperty(this,'stdout',{value:stdout,enumerable:false});}
}
import { PROJECT,ENVIRONMENTS,railwayBinary,railwayEnv } from './railwayQuranOps';
const targets={app:'1ff57ef9-b793-4130-ae60-ce8392172cf8',skia:'18de6ea4-108a-4346-8474-c7b05b81943b'} as const;
function safeOperatorDiagnostic(value:string):string|null{
 const clean=value.split(String.fromCharCode(27)).map(part=>part.replace(/^\[[0-9;]*m/u,'')).join('');
 if(clean.includes('Maximum SSH connections reached for this service'))return 'SSH_CONNECTION_LIMIT';
 for(const line of clean.split(/\r?\n/u)){
  if(/^D7_FONT_[A-Z0-9_:]+$/u.test(line))return line;
  if(line.startsWith('{')){try{const parsed=JSON.parse(line);if(parsed.error==='D7_ARTIFACT_OPERATOR_FAILED')return JSON.stringify({error:parsed.error,assertion:typeof parsed.assertion==='string'?parsed.assertion.replace(/[^A-Z0-9_ :.-]/gu,'').slice(0,180):null,cause_code:typeof parsed.cause_code==='string'&&/^[A-Z0-9_]+$/u.test(parsed.cause_code)?parsed.cause_code:null});}catch{/* Non-JSON CLI text is diagnostic data only. */}}
 }
 const kinds=['SyntaxError','ReferenceError','TypeError','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ECONNREFUSED','ENOENT','EACCES','ENOSPC','base64','gzip','sha256sum','Killed','exit code','status 1'];
 const found=kinds.filter(kind=>clean.includes(kind));
 return JSON.stringify({diagnostic_kinds:found,diagnostic_lines:clean.split(/\r?\n/u).length,diagnostic_characters:clean.length});
}
export async function d7ServiceCommand(target:keyof typeof targets,command:string,input?:string):Promise<string>{
 const child=spawn(railwayBinary,['ssh','--project',PROJECT,'--environment',ENVIRONMENTS.production,'--service',targets[target],'--',command],{env:{...railwayEnv,RAILWAY_AGENT_SESSION:'ayahx-d7-20261011'},stdio:['pipe','pipe','pipe']});
 let stdinFailed=false;child.stdin.on('error',()=>{stdinFailed=true;});child.stdin.end(input);
 const chunks:Buffer[]=[];let diagnostic='';child.stdout.on('data',(chunk:Buffer)=>chunks.push(chunk));child.stderr.on('data',(chunk:Buffer)=>{diagnostic=(diagnostic+chunk.toString('utf8')).slice(-8192);});
 await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('D7_OPERATOR_SSH_START_FAILED')));child.once('close',code=>{const output=Buffer.concat(chunks).toString('utf8');return code===0?resolve():reject(new D7OperatorError(code,output,createHash('sha256').update(output+'\n'+diagnostic).digest('hex'),safeOperatorDiagnostic(output+'\n'+diagnostic)));});});
 if(stdinFailed)throw new Error('D7_OPERATOR_STDIN_FAILED');return Buffer.concat(chunks).toString('utf8');
}
/** New job-scoped directory only. No access to historical scratch files. */
export async function d7RunBundle(target:keyof typeof targets,bytes:Buffer,args:readonly string[]=[]):Promise<string>{
 const directory='/tmp/ayahx-d7-operator-'+randomUUID(),packed=gzipSync(bytes).toString('base64');
 const quote=(value:string)=>"'"+value.replace(/'/gu,"'\\''")+"'";
 const digest=createHash('sha256').update(bytes).digest('hex');
 // One SSH connection and one finite stdin stream; no per-chunk SSH sessions.
 // Short base64 lines also avoid terminal canonical-input limits.
 const payload=packed.match(/.{1,1024}/gu)!.join('\n')+'\n';
 return d7ServiceCommand(target,'set -e; mkdir '+quote(directory)+'; trap '+quote('rm -rf -- '+quote(directory))+' EXIT; base64 -d | gzip -d > '+quote(directory+'/operator.cjs')+'; test "$(sha256sum '+quote(directory+'/operator.cjs')+' | cut -d " " -f1)" = '+quote(digest)+'; NODE_PATH="$PWD/node_modules" node '+quote(directory+'/operator.cjs')+' '+args.map(quote).join(' ')+' 2>&1',payload);
}
