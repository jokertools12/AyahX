/** Short sequential SSH sessions; approval hashes come from the independent local CLI. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const option=(name:string):string=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
if(!process.argv.includes('--confirm-production'))throw new Error('PRODUCTION_CONFIRM_REQUIRED');
const local=option('--local-db');assert.match(local,/^ayahx_d2_[a-z0-9_]+$/u);
const manifest=JSON.parse(readFileSync(option('--manifest'),'utf8')) as {results:Array<{slug:string;rows:number}>};
const previous=JSON.parse(readFileSync(option('--previous-report'),'utf8')) as {results:Array<{slug:string;rows:number;sha256:string}>;started_at:string;sql_sha256:string};
previous.results.forEach((r,i)=>{assert.equal(r.slug,manifest.results[i].slug);assert.equal(r.rows,manifest.results[i].rows);});
const resumed=process.argv.includes('--resume-report')?JSON.parse(readFileSync(option('--resume-report'),'utf8')):null;
const report:{started_at:string;original_started_at:string;original_full_sql_sha256:string;results:Array<Record<string,unknown>>;approvals:Array<Record<string,unknown>>;completed?:boolean;failure?:string;elapsed_ms?:number;end_at?:string} = resumed??{started_at:new Date().toISOString(),original_started_at:previous.started_at,original_full_sql_sha256:previous.sql_sha256,results:[...previous.results],approvals:[]};
const began=Date.now();const save=()=>writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');
const common:string[]=[];for(const key of ['--manifest','--corpus','--input-dir','--preflight'])common.push(key,option(key));
async function run(target:'local'|'production',slug:string,apply:boolean,sha?:string):Promise<Record<string,unknown>> {
  assert.match(slug,/^[a-z0-9_]+$/u);
  const childReport=join(process.env.TEMP!,'ayahx-d3-short-'+target+'-'+slug+'.json');
  const args=['--import','tsx','scripts/import-qud-timings.ts','--target',target,'--one',slug,'--report',childReport,'--sql',join(process.env.TEMP!,'ayahx-d3-short-'+target+'-'+slug+'.sql'),...common];
  if(target==='local')args.push('--local-db',local);if(apply)args.push('--apply','--confirm-production');if(sha)args.push('--expected-sql-sha',sha);
  const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();
  const code=await new Promise<number|null>((accept,reject)=>{child.once('error',()=>reject(new Error('CLI_START_FAILED')));child.once('close',accept);});
  const evidence=JSON.parse(readFileSync(childReport,'utf8')) as Record<string,unknown>;
  if(code!==0||evidence.failure)throw new Error(String(evidence.failure??'CLI_EXIT_FAILED'));
  return evidence;
}
try {
  for(const input of manifest.results.slice(report.results.length)) {
    const proof=await run('local',input.slug,false);const sha=String(proof.sql_sha256);
    assert.equal(proof.dry_run,true);assert.match(sha,/^[a-f0-9]{64}$/u);
    report.approvals.push({slug:input.slug,local_sql_sha256:sha,local_database:local});save();
    const applied=await run('production',input.slug,true,sha);assert.equal(applied.completed,true);assert.equal(applied.sql_sha256,sha);
    const result=(applied.results as Array<Record<string,unknown>>)[0];assert.equal(result.slug,input.slug);assert.equal(result.rows,input.rows);
    const serial=applied.serial as {ssh_exit_code:number;mysql_close_acknowledged:boolean;commit_acknowledged:boolean};assert.equal(serial.ssh_exit_code,0);assert.equal(serial.mysql_close_acknowledged,true);assert.equal(serial.commit_acknowledged,true);
    report.results.push({...result,sql_sha256:sha,serial:applied.serial,disk_before:applied.disk_before,disk_after:applied.disk_after,wall_clock_ms:applied.wall_clock_ms});save();
    console.log(JSON.stringify({verified_recitations:report.results.length,slug:input.slug,rows:input.rows}));
  }
  assert.equal(report.results.reduce((n,r)=>n+Number(r.rows),0),manifest.results.reduce((n,r)=>n+r.rows,0));report.completed=true;
} catch(error){report.failure=error instanceof Error?error.message:'SERIAL_IMPORT_FAILED';process.exitCode=1;console.error(report.failure);}
finally{report.elapsed_ms=Date.now()-began;report.end_at=new Date().toISOString();save();}
