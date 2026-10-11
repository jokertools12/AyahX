/** Root-only real local DB + providers + Skia/FFmpeg. Never writes SQL. */
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative,isAbsolute,join } from 'node:path';
import mysql from 'mysql2/promise';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
import { CatalogRenderManifestService } from '../server/services/catalogRenderManifest';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { renderCatalogV2Video } from '../server/services/renderV2Executor';
import { CatalogError } from '../server/services/catalogContracts';
import { RenderV2QaError } from '../server/services/renderV2Qa';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
assert.ok(process.argv.includes('--local-rehearsal'),'ROOT_LOCAL_OPT_IN_REQUIRED');
const database=process.env.AYAHX_D7_LOCAL_SCHEMA??'ayahx_d2_d7_restored_20261011';assert.match(database,/^ayahx_d2_d7_restored_\d{8}$/u);
const directory=resolve(option('--directory')),rel=relative(resolve('.'),directory);assert.ok(rel.startsWith('..')||isAbsolute(rel));
const matrix=JSON.parse(await readFile(option('--matrix'),'utf8')) as {cases:Array<{id:string;request:unknown;expected_result:string;recitation_slug?:string;provider?:string;surah?:number;from?:number;to?:number}>};
const chosen=process.argv.includes('--case')?matrix.cases.filter(row=>option('--case').split(',').includes(row.id)):matrix.cases;assert.ok(chosen.length);
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database,connectionLimit:1,dateStrings:true});
const builder=new CatalogRenderManifestService({db:catalogDatabaseFromPool(pool),source:new CatalogAudioSource()});
await mkdir(directory,{recursive:true});let failed=false;
try{
 const [version]=await pool.query<mysql.RowDataPacket[]>('SELECT VERSION() version');assert.equal(version[0].version,'9.7.2');
 for(const item of chosen){
  const report:Record<string,unknown>={id:item.id,scope:'LOCAL_REAL_DB_PROVIDER_SKIA_FFMPEG',started_at:new Date().toISOString(),expected:item.expected_result,passed:false,production_writes:0};
  try{
   const manifest=await builder.build(item.request);
   assert.equal(item.expected_result,'SUCCESS','EXPECTED_SERVER_REFUSAL');
   const result=await renderCatalogV2Video({manifest,outputPath:join(directory,item.id+'.mp4')});
   Object.assign(report,{passed:result.qaReport.passed,qa:result.qaReport,audio_plan_hash:manifest.audioPlanHash,timing_version_hash:manifest.timingVersionHash});
  }catch(error){
   if(error instanceof RenderV2QaError)Object.assign(report,{failure:error.code,qa:error.qaReport});
   else if(error instanceof CatalogError)Object.assign(report,{failure:error.code,detail:error.details,passed:item.expected_result===error.code});
   else Object.assign(report,{failure:'LOCAL_RENDER_OPERATOR_FAILED'});
  }
  report.finished_at=new Date().toISOString();await writeFile(join(directory,item.id+'.report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({id:item.id,passed:report.passed,failure:report.failure??null}));
  if(!report.passed){failed=true;break;}
 }
}finally{await pool.end();}
if(failed)process.exitCode=1;
