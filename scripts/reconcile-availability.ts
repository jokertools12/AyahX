/** Explicit CLI. Defaults to dry-run. Single connection, no timing/canonical writes. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve,relative,isAbsolute } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { computeChapterAvailability, availabilityFingerprint, type AvailabilityChapter, type AvailabilityTiming, type ChapterAvailability } from '../server/services/recitationAvailability';
import { sqlLiteral } from '../server/services/qudCatalogSql';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
import { ENVIRONMENTS } from './lib/railwayQuranOps';
const option=(key:string):string=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const target=option('--target'); const apply=process.argv.includes('--apply');
assert.ok(['local','production'].includes(target),'EXPLICIT_TARGET_REQUIRED');
if(target==='production' && apply) assert.ok(process.argv.includes('--confirm-production'),'PRODUCTION_CONFIRM_REQUIRED');
const local=target==='local'?await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:option('--local-db'),charset:'utf8mb4',multipleStatements:true}):null;
if(local) assert.match(option('--local-db'),/^ayahx_d4_[a-z0-9_]+$/u);
const remote=target==='production'?await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply}):null;
const read=async(sql:string):Promise<Array<Record<string,unknown>>>=>local?(await local.query<RowDataPacket[]>(sql))[0].map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record):(await remote!.read(sql+';')).trim().split('\n').filter(Boolean).map(r=>JSON.parse(r));
const execute=async(sql:string,rows:number):Promise<void>=>{if(!apply)throw new Error('DRY_RUN_WRITE_BLOCKED');if(local)await local.query(sql);else await remote!.executeStatements([{sql:sql+';',rowCount:rows}],async()=>{const disk=await remote!.storage();if(disk.available_bytes/disk.total_bytes<.2)throw new Error('D4_SPACE_GUARD');const raw=await remote!.read('SELECT @@max_allowed_packet;');if(Buffer.byteLength(sql)>Math.min(Number(raw.trim())/4,4*1024*1024))throw new Error('D4_PACKET_GUARD');});};
const report:Record<string,unknown>={checked_at:new Date().toISOString(),target,dry_run:!apply};
try{
  const [identity]=await read("SELECT JSON_OBJECT('version',VERSION()) record");assert.equal(identity.version,'9.7.2');
  const legal=await read("SELECT JSON_OBJECT('surah',surah,'ayah',ayah,'words',words_count) record FROM quran_ayahs ORDER BY surah,ayah");
  const legalByChapter=new Map<number,Map<number,number>>();for(const row of legal){const group=legalByChapter.get(Number(row.surah))??new Map<number,number>();group.set(Number(row.ayah),Number(row.words));legalByChapter.set(Number(row.surah),group);}
  const recitations=await read("SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'reciter',p.name_ar,'riwayah',r.riwayah_code,'source',r.channel,'canonical',r.canonical_text_available) record FROM recitations r JOIN reciters p ON p.id=r.reciter_id ORDER BY r.slug");
  const results:Array<Record<string,unknown>>=[];const all:ChapterAvailability[]=[];const near:Array<Record<string,unknown>>=[];const updates:string[]=[];let changes=0;
  for(const recitation of recitations){
    const id=sqlLiteral(String(recitation.id));
    const chapters=await read(`SELECT JSON_OBJECT('id',id,'surah',surah,'expected_ayahs',expected_ayahs,'available_ayahs',available_ayahs,'coverage_mismatch',coverage_mismatch,'ayahs_complete',ayahs_complete,'timing_complete',timing_complete,'is_complete',is_complete,'availability_state',availability_state,'available_runs',available_runs,'run_count',run_count,'max_run_ayahs',max_run_ayahs,'ready_ayahs',ready_ayahs,'near_complete_missing',near_complete_missing) record FROM recitation_chapters WHERE recitation_id=${id} COLLATE utf8mb4_unicode_ci ORDER BY surah`);
    const timingRows=await read(`SELECT JSON_OBJECT('surah',surah,'ayah',ayah,'coverage_words',coverage_words,'expected_words',expected_words,'review_status',review_status,'review_reasons',review_reasons,'missing_words',missing_words) record FROM ayah_timings WHERE recitation_id=${id} COLLATE utf8mb4_unicode_ci ORDER BY surah,ayah`);
    const grouped=new Map<number,AvailabilityTiming[]>();for(const row of timingRows){const group=grouped.get(Number(row.surah))??[];group.push(row as unknown as AvailabilityTiming);grouped.set(Number(row.surah),group);}
    const counts={complete:0,near_complete:0,partial:0,unavailable:0};let ready=0,maxRun=0;
    for(const chapter of chapters){
      const input:AvailabilityChapter={id:String(chapter.id),surah:Number(chapter.surah),canonical:Boolean(Number(recitation.canonical)),expected_ayahs:chapter.expected_ayahs===null?null:Number(chapter.expected_ayahs),available_ayahs:Number(chapter.available_ayahs),coverage_mismatch:Boolean(Number(chapter.coverage_mismatch)),ayahs_complete:Boolean(Number(chapter.ayahs_complete)),is_complete:Boolean(Number(chapter.is_complete)),timing_complete:Boolean(Number(chapter.timing_complete))};
      const computed=computeChapterAvailability(input,grouped.get(input.surah)??[],legalByChapter.get(input.surah)??new Map());all.push(computed);counts[computed.availability_state]++;ready+=computed.ready_ayahs;maxRun=Math.max(maxRun,computed.max_run_ayahs);
      if(computed.availability_state==='near_complete')near.push({slug:recitation.slug,surah:input.surah,missing:computed.near_complete_missing});
      const keys=['availability_state','available_runs','run_count','max_run_ayahs','ready_ayahs','near_complete_missing'] as const;
      const differs=keys.some(k=>JSON.stringify(chapter[k])!==JSON.stringify(computed[k]));
      if(differs){changes++;const fields=keys.map(k=>`${k}=${sqlLiteral(typeof computed[k]==='object'?JSON.stringify(computed[k]):computed[k])}`).join(',');updates.push(`UPDATE recitation_chapters SET ${fields} WHERE id=${sqlLiteral(input.id)} COLLATE utf8mb4_unicode_ci;`);}
    }
    const absent=[...legalByChapter.keys()].filter(s=>!chapters.some(c=>Number(c.surah)===s)).sort((a,b)=>a-b);
    results.push({slug:recitation.slug,reciter:recitation.reciter,riwayah:recitation.riwayah,source:recitation.source,...counts,
      unavailable:counts.unavailable+absent.length,catalog_chapters:chapters.length,absent_chapters:absent,ready_ayahs:ready,max_run_ayahs:maxRun});
    if(process.argv.includes('--progress'))console.log(JSON.stringify({checked_recitations:results.length,total_recitations:recitations.length,changes_so_far:changes}));
  }
  const fingerprint=availabilityFingerprint(all);const total=(key:string)=>results.reduce((n,r)=>n+Number(r[key]),0);
  const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as {coverage:Array<{complete:number;missing_1_to_3:number}>};
  assert.equal(total('complete'),baseline.coverage.reduce((n,r)=>n+Number(r.complete),0),'D3_COMPLETE_COUNT_STOP');
  assert.equal(near.length,baseline.coverage.reduce((n,r)=>n+Number(r.missing_1_to_3),0),'NEAR_COMPLETE_COUNT_STOP');
  if(process.argv.includes('--expected-report')){const previous=JSON.parse(readFileSync(option('--expected-report'),'utf8'));assert.equal(fingerprint,previous.fingerprint,'AVAILABILITY_PLAN_MISMATCH');}
  const sql=updates.join('\n')+'\n';report.sql_sha256=createHash('sha256').update(sql).digest('hex');report.sql_bytes=Buffer.byteLength(sql);
  if(process.argv.includes('--sql-output')){const path=resolve(option('--sql-output'));const outside=relative(process.cwd(),path);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_OUTPUT_REQUIRED');writeFileSync(path,sql);}
  if(apply){
    let batch:string[]=[];let bytes=0;const flush=async():Promise<void>=>{if(!batch.length)return;await execute(batch.join('\n'),batch.length);batch=[];bytes=0;};
    for(const update of updates){const size=Buffer.byteLength(update);if(size>256*1024)throw new Error('AVAILABILITY_ROW_PACKET_MARGIN');if(batch.length>=250||bytes+size>256*1024)await flush();batch.push(update);bytes+=size;}await flush();if(remote)await remote.commit();
  }
  if(apply){const stored=await read("SELECT JSON_OBJECT('id',id,'availability_state',availability_state,'available_runs',available_runs,'run_count',run_count,'max_run_ayahs',max_run_ayahs,'ready_ayahs',ready_ayahs,'near_complete_missing',near_complete_missing) record FROM recitation_chapters ORDER BY id");for(const row of stored){const expected=all.find(c=>c.id===row.id);assert.ok(expected);for(const key of ['availability_state','available_runs','run_count','max_run_ayahs','ready_ayahs','near_complete_missing'] as const)assert.deepEqual(row[key],expected[key],'STORED_AVAILABILITY_MISMATCH');}}
  report.fingerprint=fingerprint;report.chapters=all.length;report.changes=changes;
  report.totals={complete:total('complete'),near_complete:near.length,partial:total('partial'),unavailable:total('unavailable')};
  report.absent_catalog_chapters=results.reduce((n,r)=>n+(r.absent_chapters as number[]).length,0);report.recitations=results;report.passed=true;
  if(process.argv.includes('--summary'))writeFileSync(option('--summary'),JSON.stringify({fingerprint,totals:report.totals,recitations:results},null,2)+'\n');
  if(process.argv.includes('--near-complete'))writeFileSync(option('--near-complete'),JSON.stringify({fingerprint,chapters:near},null,2)+'\n');
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw error;}
finally{if(local)await local.end();if(remote)report.serial=await remote.close();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,changes:report.changes,fingerprint:report.fingerprint,totals:report.totals}));
