/** Private operator fixture: owned noise, explicitly NOT a Quran recording or approved timing. */
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CatalogError,type CatalogDatabase } from './catalogContracts';
import { catalogStorageFromEnvironment } from './catalogStorageRuntime';
import { RenderManifestV2Schema,type RenderManifestV2 } from '../models/renderManifestV2';
import { toRenderTimeline } from '../../shared/timing/toRenderTimeline';
import { getFfmpegBinary } from './ffmpegBinary';
import { runRenderV2Process } from './renderV2Process';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function createOwnedRenderLabFixture(db:Pick<CatalogDatabase,'read'>):Promise<{manifest:RenderManifestV2;cleanup:()=>Promise<void>}>{
 const id=randomUUID(),prefix='test/d7-'+randomUUID()+'/licensed/owned-noise-qa/001/';
 const scratch=await mkdtemp(path.join(os.tmpdir(),'ayahx-d7-owned-fixture-'));
 const writer=catalogStorageFromEnvironment('r2','read_write',[]);
 let objectKey:string|undefined;
 try{
  const [version]=await db.read("SELECT v.id,v.checksum FROM quran_text_versions v JOIN riwayat r ON r.id=v.riwayah_id WHERE v.is_active=1 AND r.code='hafs_an_asim'");
  const rows=await db.read('SELECT a.ayah,a.text_uthmani,a.words_count,w.position,w.text_uthmani word_text FROM quran_ayahs a JOIN quran_words w ON w.ayah_id=a.id WHERE a.text_version_id=? AND a.surah=1 AND a.ayah=1 ORDER BY w.position',[version.id]);
  assert.ok(rows.length>0&&rows.length===Number(rows[0].words_count),'CANONICAL_FIXTURE_WORDS_REQUIRED');
  const words=rows.map((row,index)=>({wordIndex:index+1,text:String(row.word_text),canonicalWordKey:`1:1:${index+1}`}));
  // Deliberately estimated synthetic intervals: ayah-only, never word glow.
  const timing=words.map((word,index)=>[word.wordIndex,index,1000+index*700,1700+index*700] as [number,number,number,number]);
  const timeline=toRenderTimeline([{ayah:1,coordinate:'source_ms',source:'owned_noise_qa',source_offset_ms:null,words:timing,quality:'estimated',review_status:'needs_review',word_highlight_enabled:false}],{chapterOffsetMs:0,sourceFormat:'absolute_source',padMs:150,allowAyahOnly:true});
  const file=path.join(scratch,'owned.mp3');
  await runRenderV2Process(getFfmpegBinary(),['-nostdin','-y','-v','error','-f','lavfi','-i','anoisesrc=color=pink:seed=73011:sample_rate=44100:duration=8','-ac','1','-c:a','libmp3lame','-b:a','192k',file]);
  const bytes=await readFile(file),sha256=createHash('sha256').update(bytes).digest('hex');objectKey=prefix+sha256+'.mp3';
  const capability=await writer.presignPut({objectKey,sizeBytes:bytes.length,sha256,contentType:'audio/mpeg'},120);
  const response=await fetch(capability.url,{method:'PUT',headers:capability.requiredHeaders,body:bytes});
  if(!response.ok)throw new CatalogError('OWNED_FIXTURE_UPLOAD_FAILED',502);
  const audioPlan={recitationId:id,mode:'surah_slice',coordinate:'source_ms',provider:'licensed_file',license:'owned_generated_noise_QA_only',attribution:'AyahX owned QA fixture; no Quran audio',parts:[{url:'',sliceFromMs:timeline.sourceWindow.fromMs,sliceToMs:timeline.sourceWindow.toMs}],fallbackUsed:false,allowedHosts:[],sourceIdentity:{kind:'licensed_r2',objectKey,sha256,sourceId:id}};
  const manifest=RenderManifestV2Schema.parse({schemaVersion:'2.0.0',rendererVersion:'2.0.0',renderEngine:'skia_canvas',repetitionDisplayMode:'canonical',recitation:{id,slug:'owned-noise-qa-fixture',reciterId:id,reciterName:'اختبار صوت مملوك غير قرآني',providerCode:'licensed_file'},canonicalTextVersion:version,canonicalAyahRange:{surahNumber:1,surahName:'الفاتحة',startAyah:1,endAyah:1,ayahs:[{numberInSurah:1,text:String(rows[0].text_uthmani),words}]},timeline:{...timeline,gaps:timeline.gaps??[],ayahs:timeline.ayahs.map(row=>({...row,words:[]}))},audioPlan,audioPlanHash:digest(audioPlan),timingVersionHash:digest(timeline),options:{},warnings:[{code:'OWNED_NOISE_QA_NOT_QURAN_TIMING'},{code:'ESTIMATED_TIMING',ayah:1}]});
  const key=objectKey;
  return {manifest,cleanup:async()=>{const storage=catalogStorageFromEnvironment('r2','read_write',[]);try{await storage.deleteObject(key);if(await storage.head(key))throw new CatalogError('OWNED_FIXTURE_CLEANUP_FAILED',502);}finally{await storage.close?.();}}};
 }catch(error){if(objectKey)await writer.deleteObject(objectKey);throw error;}
 finally{await writer.close?.();await rm(scratch,{recursive:true,force:true});}
}
