/** Read-only complete canonical corpus proof, executed on the actual Linux worker. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pool } from '../server/db';
import { auditRenderV2CorpusFonts } from '../server/services/renderV2Fonts';
import type { RowDataPacket } from 'mysql2/promise';
async function main(){
 if(process.argv.includes('--raster-batch')){
  const words=JSON.parse(readFileSync(0,'utf8')) as string[];
  assert.ok(words.length>0&&words.length<=500);
  try{console.log(JSON.stringify(auditRenderV2CorpusFonts(words)));}finally{await pool.end();}return;
 }
 try {
 const [version]=await pool.query<RowDataPacket[]>('SELECT VERSION() version');assert.equal(version[0].version,'9.7.2');
 const [rows]=await pool.query<RowDataPacket[]>('SELECT w.text_uthmani FROM quran_words w JOIN quran_ayahs a ON a.id=w.ayah_id JOIN quran_text_versions v ON v.id=a.text_version_id JOIN riwayat r ON r.id=v.riwayah_id WHERE v.is_active=1 AND r.code=\'hafs_an_asim\' ORDER BY a.surah,a.ayah,w.position');
 const words=[...new Set(rows.map(row=>String(row.text_uthmani)))].sort();
 const proof=auditRenderV2CorpusFonts(words,{raster:false});
 let batches=0;
 for(let start=0;start<words.length;start+=500){
  // Bound native shaping caches by a fresh child; every unique word still renders in all six fonts.
  const child=spawn(process.execPath,[__filename,'--raster-batch'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const output:Buffer[]=[];child.stdout.on('data',(chunk:Buffer)=>output.push(chunk));child.stderr.resume();
  const timer=setTimeout(()=>child.kill('SIGKILL'),120_000);
  child.stdin.end(JSON.stringify(words.slice(start,start+500)));
  try{await new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('RASTER_CHILD_START_FAILED')));child.once('close',(code,signal)=>code===0?resolve():reject(new Error('RASTER_CHILD_EXIT_'+code+'_'+signal)));});}
  finally{clearTimeout(timer);}
  const line=Buffer.concat(output).toString('utf8').split(/\r?\n/u).findLast(row=>row.startsWith('{'));
  assert.ok(line,'RASTER_CHILD_JSON_REQUIRED');
  const part=JSON.parse(line) as typeof proof;
  for(const font of proof.fonts){const found=part.fonts.find(row=>row.family===font.family)!;assert.equal(found.sha256,font.sha256);font.rendered_words+=found.rendered_words;font.words_without_ink+=found.words_without_ink;font.passed&&=found.passed;}
  batches++;
  if(batches%5===0)console.log(JSON.stringify({progress:true,raster_words:Math.min(start+500,words.length),batches}));
 }
 proof.passed=proof.fonts.every(font=>font.passed&&font.rendered_words===words.length);
 console.log(JSON.stringify({...proof,checked_at:new Date().toISOString(),mysql_version:version[0].version,source_words:rows.length,network_font_requests:0,method:'local_cmap_indices_and_native_raster_every_unique_word_bounded_child_batches',raster_batch_size:500,batches,sql_writes:0}));
 if(!proof.passed)process.exitCode=1;
} finally { await pool.end(); }}
void main().catch(error=>{const code=error instanceof Error&&/^[A-Z0-9_]+$/u.test(error.message.toUpperCase())?error.message.toUpperCase():'AUDIT_FAILED';console.error('D7_FONT_'+code);process.exitCode=1;});
