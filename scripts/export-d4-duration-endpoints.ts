/** Root-only real local catalog reads. Coordinate conversion stays in toRenderTimeline. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {toRenderTimeline,type SourceAyahTiming} from '../shared/timing/toRenderTimeline';
import {sha256} from './lib/d4AuditSqlPlan';
const option=(key:string)=>{const i=process.argv.indexOf(key);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
const output=resolve(option('--out')),outside=relative(process.cwd(),output);assert.ok(outside==='..'||outside.startsWith('..'+sep)||isAbsolute(outside),'PRIVATE_ARTIFACT_REQUIRED');
const bytes=readFileSync('docs/data/voice-identity-report.json'),evidence=JSON.parse(bytes.toString('utf8'));
const measured=evidence.duration_quality_comparison.measurements as Array<{slug:string;surah:number;original_source_url:string;scope:string}>;
assert.ok(Array.isArray(measured));
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d4_catalog_20261010',charset:'utf8mb4'});
try{
  const [chapters]=await db.query<RowDataPacket[]>('SELECT c.id,r.id recitation_id,r.slug,r.channel,r.offset_verified,c.surah,c.audio_url,c.chapter_offset_ms,c.coverage_mismatch,c.timing_complete,c.expected_ayahs,c.coverage_words,c.expected_words FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id ORDER BY r.slug,c.surah');
  const results=[];
  for(const measurement of measured){
    const chapter=chapters.find(c=>c.slug===measurement.slug&&Number(c.surah)===measurement.surah);assert.ok(chapter,'MEASURED_CHAPTER_MISSING');
    const [rows]=await db.query<RowDataPacket[]>('SELECT ayah,coordinate,source,source_offset_ms,words FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah',[chapter.recitation_id,chapter.surah]);
    const timings=rows.map(r=>({...r,words:typeof r.words==='string'?JSON.parse(r.words):r.words})) as SourceAyahTiming[];
    let sourceEndMs:number|null=null,reason:string|null=null;
    const standalone=measurement.scope==='COMPLETE_ORIGINAL_CATALOG_SURAH_SOURCE'&&measurement.original_source_url===chapter.audio_url&&chapter.channel!=='youtube';
    const chapterOffset=chapter.chapter_offset_ms===null&&standalone?0:chapter.chapter_offset_ms;
    if(chapterOffset===null)reason='CHAPTER_OFFSET_UNAVAILABLE';
    else try{sourceEndMs=toRenderTimeline(timings,{chapterOffsetMs:Number(chapterOffset),sourceFormat:'qud_release',padMs:0}).sourceWindow.toMs;}
    catch(error){if(error instanceof Error&&/^TIMELINE_[A-Z_]+$/u.test(error.message))reason=error.message;else throw error;}
    results.push({slug:chapter.slug,surah:Number(chapter.surah),original_url_sha256:sha256(String(chapter.audio_url)),source_end_ms:sourceEndMs,reason,timing_rows:rows.length,timing_complete:chapter.timing_complete,coverage_mismatch:chapter.coverage_mismatch,expected_ayahs:chapter.expected_ayahs,coverage_words:chapter.coverage_words,expected_words:chapter.expected_words,offset_verified:chapter.offset_verified,offset_basis:chapter.chapter_offset_ms!==null?'catalog_chapter_offset':standalone?'standalone_original_chapter_resource_origin':'unavailable',endpoint_scope:'QUD_EXPECTED_LAST_STORED_WORD_NOT_ALIGNMENT_PROOF'});
  }
  writeFileSync(output,JSON.stringify({checked_at:new Date().toISOString(),source_artifact_sha256:sha256(bytes),catalog_chapters:chapters.length,measurements:results,network_requests:0,db_writes:0},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({catalog_chapters:chapters.length,measured_chapters:results.length,convertible:results.filter(r=>r.source_end_ms!==null).length,db_writes:0}));
}finally{await db.end();}
