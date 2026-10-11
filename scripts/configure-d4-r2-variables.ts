/** Root-only explicit credentials provisioning. Values use CLI stdin, never argv/logs. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {PROJECT,ENVIRONMENTS,railwayBinary,railwayEnv} from './lib/railwayQuranOps';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1],key);return process.argv[i+1];};
assert.ok(process.argv.includes('--confirm-approved-token-provisioning'));
const path=resolve(option('--credentials')),outside=relative(process.cwd(),path);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_CREDENTIALS_REQUIRED');
const credential=JSON.parse(readFileSync(path,'utf8'));
assert.match(credential.accountId,/^[a-f0-9]{32}$/u);assert.equal(credential.endpoint,`https://${credential.accountId}.r2.cloudflarestorage.com`);assert.equal(credential.ttlDays,30);
const services=[{id:'1ff57ef9-b793-4130-ae60-ce8392172cf8',name:'AyahX',writer:true},{id:'18de6ea4-108a-4346-8474-c7b05b81943b',name:'render-worker-skia',writer:false},{id:'68eea2bb-ae45-4af7-8962-ba9e16e466fc',name:'render-control',writer:false}];
const run=(args:string[],input?:string)=>new Promise<string>((accept,reject)=>{const child=spawn(railwayBinary,args,{env:railwayEnv,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',(b:Buffer)=>{output+=b.toString('utf8');});child.stderr.on('data',()=>{/* CLI text can contain values; never expose it. */});child.once('error',()=>reject(new Error('R2_VARIABLE_CLI_START_FAILED')));child.once('close',code=>code===0?accept(output):reject(new Error('R2_VARIABLE_CLI_FAILED')));child.stdin.on('error',()=>reject(new Error('R2_VARIABLE_STDIN_FAILED')));child.stdin.end(input);});
const results:unknown[]=[];const report={started_at:new Date().toISOString(),adapter_changed:false,deploys_triggered:false,secrets_logged:false,results};
try{
  for(const [name,environment]of Object.entries(ENVIRONMENTS)){
    const config=credential[name];assert.equal(config.bucket,`ayahx-audio-${name==='production'?'prod':'staging'}`);
    for(const role of ['writer','reader']){assert.match(config[role].accessKeyId,/^[a-f0-9]{32}$/u);assert.match(config[role].secretAccessKey,/^[a-f0-9]{64}$/u);}
    for(const service of services){
      const scope=['--project',PROJECT,'--environment',environment,'--service',service.id];
      const old=JSON.parse(await run(['variable','list',...scope,'--json']));
      if(!service.writer)assert.ok(!old.R2_ACCESS_KEY_ID&&!old.R2_SECRET_ACCESS_KEY,'WORKER_WRITER_CREDENTIAL_ALREADY_PRESENT');
      const desired:Record<string,string>={R2_ACCOUNT_ID:credential.accountId,R2_ENDPOINT:credential.endpoint,R2_BUCKET:config.bucket,R2_READ_ACCESS_KEY_ID:config.reader.accessKeyId,R2_READ_SECRET_ACCESS_KEY:config.reader.secretAccessKey};
      if(service.writer){desired.R2_ACCESS_KEY_ID=config.writer.accessKeyId;desired.R2_SECRET_ACCESS_KEY=config.writer.secretAccessKey;}
      const changed:string[]=[];for(const [key,value]of Object.entries(desired))if(old[key]!==value){await run(['variable','set',key,'--stdin',...scope,'--skip-deploys','--json'],value);changed.push(key);}
      const after=JSON.parse(await run(['variable','list',...scope,'--json']));for(const [key,value]of Object.entries(desired))assert.equal(after[key],value,'R2_VARIABLE_READBACK_FAILED');
      if(!service.writer)assert.ok(!after.R2_ACCESS_KEY_ID&&!after.R2_SECRET_ACCESS_KEY,'WORKER_WRITER_CREDENTIAL_PRESENT');
      const item={environment:name,service:service.name,variable_names:Object.keys(desired),changed_names:changed,readback_matched:true,writer_granted:service.writer};results.push(item);console.log(JSON.stringify(item));
    }
  }
  writeFileSync(option('--report'),JSON.stringify({...report,passed:true,finished_at:new Date().toISOString()},null,2)+'\n');
}catch{writeFileSync(option('--report'),JSON.stringify({...report,passed:false,failure:'R2_VARIABLE_PROVISIONING_FAILED',finished_at:new Date().toISOString()},null,2)+'\n');throw new Error('R2_VARIABLE_PROVISIONING_FAILED');}
