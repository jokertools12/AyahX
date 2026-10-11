/** Root-only transport for existing approved production app/Skia services. */
import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
export class D7OperatorError extends Error {
 constructor(code:number|null,public readonly stdout:string,public readonly diagnosticHash:string,public readonly safeDiagnostic:string|null){super('D7_OPERATOR_SSH_EXIT_'+code);Object.defineProperty(this,'stdout',{value:stdout,enumerable:false});}
}
import { PROJECT,ENVIRONMENTS,railwayBinary,railwayEnv } from './railwayQuranOps';
const targets={app:'1ff57ef9-b793-4130-ae60-ce8392172cf8',skia:'18de6ea4-108a-4346-8474-c7b05b81943b'} as const;
export async function d7ServiceCommand(target:keyof typeof targets,command:string):Promise<string>{
 const child=spawn(railwayBinary,['ssh','--project',PROJECT,'--environment',ENVIRONMENTS.production,'--service',targets[target],'--',command],{env:{...railwayEnv,RAILWAY_AGENT_SESSION:'ayahx-d7-20261011'},stdio:['ignore','pipe','pipe']});
 const chunks:Buffer[]=[];let diagnostic='';child.stdout.on('data',(chunk:Buffer)=>chunks.push(chunk));child.stderr.on('data',(chunk:Buffer)=>{diagnostic=(diagnostic+chunk.toString('utf8')).slice(-8192);});
 await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('D7_OPERATOR_SSH_START_FAILED')));child.once('close',code=>code===0?resolve():reject(new D7OperatorError(code,Buffer.concat(chunks).toString('utf8'),createHash('sha256').update(diagnostic).digest('hex'),diagnostic.split(/\r?\n/u).find(line=>/^D7_FONT_[A-Z0-9_:]+$/u.test(line))??null)));});
 return Buffer.concat(chunks).toString('utf8');
}
/** New job-scoped directory only. No access to historical scratch files. */
export async function d7RunBundle(target:keyof typeof targets,bytes:Buffer,args:readonly string[]=[]):Promise<string>{
 const directory='/tmp/ayahx-d7-operator-'+randomUUID(),packed=gzipSync(bytes).toString('base64');
 const quote=(value:string)=>"'"+value.replace(/'/gu,"'\\''")+"'";
 await d7ServiceCommand(target,'mkdir '+quote(directory));
 // Windows CreateProcess limits the entire command line to 32767 characters.
 for(let offset=0;offset<packed.length;offset+=12_000)await d7ServiceCommand(target,'printf %s '+quote(packed.slice(offset,offset+12_000))+' >> '+quote(directory+'/bundle.b64'));
 const digest=createHash('sha256').update(bytes).digest('hex');
 // The shell trap removes only this freshly generated UUID directory.
 return d7ServiceCommand(target,'set -e; trap '+quote('rm -rf -- '+quote(directory))+' EXIT; base64 -d '+quote(directory+'/bundle.b64')+' | gzip -d > '+quote(directory+'/operator.cjs')+'; test "$(sha256sum '+quote(directory+'/operator.cjs')+' | cut -d " " -f1)" = '+quote(digest)+'; NODE_PATH="$PWD/node_modules" node '+quote(directory+'/operator.cjs')+' '+args.map(quote).join(' '));
}
