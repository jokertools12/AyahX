/** Root operator: serial real render-lab CLI jobs, inspected output, exact new-artifact cleanup. */
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
import { d7ServiceCommand,d7RunBundle,D7OperatorError } from './lib/d7RailwayOperator';
const at=process.argv.indexOf('--matrix');assert.ok(at>=0);
const matrix=JSON.parse(await readFile(process.argv[at+1],'utf8'));
const selection=process.argv.indexOf('--case');assert.ok(selection>=0,'EXPLICIT_CASES_REQUIRED');
const ids=process.argv[selection+1].split(',');
const cases=ids.map(id=>id==='owned-r2'?{id,expected_result:'SUCCESS',request:null}:matrix.cases.find((row:{id:string})=>row.id===id));assert.ok(cases.every(Boolean));
const quote=(value:string)=>"'"+value.replace(/'/gu,"'\\''")+"'";
const parse=(raw:string)=>{const line=raw.split(/\r?\n/u).findLast(line=>line.startsWith('{'));assert.ok(line,'OPERATOR_JSON_REQUIRED');return JSON.parse(line);};
const cli=async(mode:string,value?:string)=>parse(await d7ServiceCommand('app','node dist-server/operators/renderLabCli.cjs '+quote(mode)+(value?' '+quote(value):'')+' --root-operated 2>&1'));
const bundle=await build({entryPoints:['scripts/d7-job-artifact.ts'],bundle:true,write:false,packages:'external',platform:'node',format:'cjs',target:'node22',logLevel:'silent'});
const artifact=async(mode:string,id:string)=>parse(await d7RunBundle('skia',Buffer.from(bundle.outputFiles[0].contents),[mode,id,'--root-operated']));
await mkdir('docs/data/render-qa',{recursive:true});
let failed=false;
for(const item of cases){
 const report:Record<string,unknown>={id:item.id,expected:item.expected_result,scope:'RAILWAY_PRODUCTION_RENDER_LAB_REAL_QUEUE',started_at:new Date().toISOString(),passed:false};
 try{
  const request=JSON.stringify(item.request);
  if(item.id!=='owned-r2'){report.dry_run=await cli('dry-run',request);assert.equal(item.expected_result,'SUCCESS','EXPECTED_REFUSAL_WAS_ACCEPTED');}
  const created=await cli(item.id==='owned-r2'?'owned-fixture':'create',item.id==='owned-r2'?undefined:request);report.job_id=created.id;
  const deadline=Date.now()+25*60_000;let status;
  do{status=await cli('status',created.id);console.log(JSON.stringify({id:item.id,job_id:created.id,status:status.status,progress:status.progress}));if(['succeeded','failed','cancelled'].includes(status.status))break;await delay(15_000);}while(Date.now()<deadline);
  report.status=status.status;report.error_code=status.error_code;
  if(status.status!=='succeeded'){report.qa=status.qa_report_json;throw new Error('REAL_QUEUE_RENDER_FAILED');}
  const inspected=await artifact('inspect',created.id);const {png_base64,...safe}=inspected;
  await writeFile('docs/data/render-qa/railway-'+item.id+'.png',Buffer.from(png_base64,'base64'));report.inspection=safe;report.passed=safe.qa.passed;
  report.cleanup=await artifact('cleanup',created.id);
  if(item.id==='owned-r2')report.owned_source_cleanup=await cli('cleanup-owned-source',created.id);
 }catch(error){
  const remote=error instanceof D7OperatorError?error.stdout.split(/\r?\n/u).findLast(line=>line.startsWith('{')):null;
  const refusal=remote?JSON.parse(remote):null;
  report.failure=refusal?.error??(error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message)?error.message:'PRODUCTION_MATRIX_OPERATOR_FAILED');
  if(refusal?.details)report.refusal_details=refusal.details;
  report.passed=report.failure===item.expected_result;
  if(!report.passed)failed=true;
 }
 report.finished_at=new Date().toISOString();await writeFile('docs/data/d7-production-'+item.id+'.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({id:item.id,passed:report.passed,failure:report.failure??null}));if(failed)break;
}
if(failed)process.exitCode=1;
