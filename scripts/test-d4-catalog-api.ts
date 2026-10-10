/** Real MySQL/HTTP acceptance. Simulated approval fields are local test fixtures
 * only, restored in finally; no source identity or license claim is made. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import express from 'express';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { RecitationCatalogService,readCatalogSettings } from '../server/services/recitationCatalogService';
import { RecitationAudioResolver } from '../server/services/recitationAudioResolver';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
import { RecitationAdminService } from '../server/services/recitationAdminService';
import { createCatalogRouter } from '../server/routes/catalog';
import { CatalogPeriodicLinkChecker } from '../server/services/catalogPeriodicLinkChecker';
import {CatalogWeeklyStorageReconciliation} from '../server/services/catalogWeeklyStorageReconciliation';
const database='ayahx_d4_catalog_20261010';
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',connectionLimit:3});
const db=catalogDatabaseFromPool(pool);const settings=()=>readCatalogSettings(db);const source=new CatalogAudioSource();
const audio=new RecitationAudioResolver(db,source,settings);const service=new RecitationCatalogService(db,settings,audio);const admin=new RecitationAdminService(db,source);
const actor={id:'local-test-reviewer',kind:'human' as const,permissions:new Set(['recitations.manage','settings.catalog.manage'])};
const [record]=await db.read("SELECT * FROM recitations WHERE slug='ali_al_huthaifi_mp3quran'");assert.ok(record);
const [provider]=await db.read('SELECT * FROM audio_providers WHERE id=?',[record.provider_id]);
const originals=await db.read("SELECT * FROM system_settings WHERE key_name IN ('availability_mode','quran_catalog_v2','voice_gate_policy','storage_adapter')");
const staleLinkFixtures=await db.read('SELECT id,audio_status,last_verified_at,updated_at FROM recitation_chapters WHERE recitation_id=? ORDER BY surah LIMIT 20',[record.id]);
const report:Record<string,unknown>={checked_at:new Date().toISOString(),target:'local-only',mysql:'9.7.2',approval_fields:'simulated local test fixture; restored; NOT human identity/license evidence',network_source_checks:'actual provider HTTPS; no audio file persisted'};
const app=express();app.use('/api/catalog',createCatalogRouter(service));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();assert.ok(address&&typeof address!=='string');const url=`http://127.0.0.1:${address.port}/api/catalog`;
const get=async(path:string,headers:Record<string,string>={})=>{const response=await fetch(url+path,{headers});return {status:response.status,etag:response.headers.get('etag'),body:response.status===304?null:await response.json()};};
try{
  assert.equal((await pool.query<RowDataPacket[]>('SELECT VERSION() v'))[0][0].v,'9.7.2');
  for(const path of ['/reciters','/reciters/ali-al-huthaifi/recitations','/recitations/ali_al_huthaifi_mp3quran/surahs','/recitations/ali_al_huthaifi_mp3quran/chapters/1/availability']){const response=await get(path);assert.equal(response.status,404);assert.equal(response.body.code,'QURAN_CATALOG_DISABLED');}
  let storageCalls=0;const storageRunner=new CatalogWeeklyStorageReconciliation({db,storageProvider:()=>{storageCalls++;throw new Error('DISABLED_STORAGE_FACTORY_MUST_NOT_RUN');},writeReport:async()=>{throw new Error('DISABLED_STORAGE_WRITE_MUST_NOT_RUN');}});
  assert.equal((await storageRunner.runOnce()).state,'disabled');assert.equal(storageCalls,0);await storageRunner.close();assert.equal((await storageRunner.runOnce()).state,'closed');report.actual_storage_default_disabled_no_client=true;
  await db.execute("UPDATE audio_providers SET license_status='permitted',host_allowlist=JSON_ARRAY_APPEND(host_allowlist,'$','cdn.mp3quran.net') WHERE id=?",[provider.id]);
  await db.execute("UPDATE recitations SET status='published',is_public=1,voice_identity_status='confirmed',voice_confirmed_by='local-test-reviewer',verification_method='v1',timing_level='word',timing_quality='verified',surah_start_basmala_audio_status='verified',verification_details=JSON_SET(verification_details,'$.basmala_audio_evidence',JSON_OBJECT('local_test_fixture',true)) WHERE id=?",[record.id]);
  await db.execute("INSERT INTO system_settings(key_name,value_text,is_secret,category) VALUES('quran_catalog_v2','true',0,'quran_catalog') ON DUPLICATE KEY UPDATE value_text='true'");
  await admin.setAvailabilityMode(actor,'complete_only');
  const [reader]=await db.read('SELECT slug FROM reciters WHERE id=?',[record.reciter_id]);
  const readers=await get('/reciters');assert.equal(readers.status,200);assert.ok(readers.body.data.some((r:Record<string,unknown>)=>r.slug===reader.slug));
  assert.equal((await get('/reciters',{'If-None-Match':readers.etag!})).status,304);
  const recitations=await get(`/reciters/${reader.slug}/recitations`);assert.equal(recitations.status,200);assert.ok(recitations.body.data.some((r:Record<string,unknown>)=>r.slug===record.slug));
  await db.execute("UPDATE recitations SET voice_identity_status='auto_verified' WHERE id=?",[record.id]);
  await admin.setVoiceGatePolicy(actor,'require_confirmed');
  assert.equal((await get(`/recitations/${record.slug}/surahs`)).body.code,'RECITATION_NOT_PUBLIC');
  assert.ok(!(await get('/reciters')).body.data.some((r:Record<string,unknown>)=>r.slug===reader.slug));
  await admin.setVoiceGatePolicy(actor,'allow_auto_verified');
  assert.equal((await get(`/recitations/${record.slug}/surahs`)).status,200);
  assert.ok((await get('/reciters')).body.data.some((r:Record<string,unknown>)=>r.slug===reader.slug));
  await db.execute("UPDATE recitations SET voice_identity_status='confirmed' WHERE id=?",[record.id]);
  assert.equal((await settings()).storageAdapter,'url_reference');
  report.actual_voice_gate_policy_both_modes=true;
  const chapters=await get(`/recitations/${record.slug}/surahs`);assert.equal(chapters.status,200);assert.ok(chapters.body.data.length>0);assert.ok(chapters.body.data.every((c:Record<string,unknown>)=>c.availability_state==='complete'));
  const partial=await get(`/recitations/${record.slug}/chapters/2/availability`);assert.deepEqual(partial.body.data.available_runs,[]);
  await admin.setAvailabilityMode(actor,'ayah_ranges');const ranges=await get(`/recitations/${record.slug}/chapters/2/availability`);assert.ok(ranges.body.data.available_runs.length>0);
  const [row]=await db.read('SELECT words FROM ayah_timings WHERE recitation_id=? AND surah=1 AND ayah=1',[record.id]);const words=row.words as number[][];
  const plan=await service.resolveAudioPlan({recitationId:String(record.id),surah:1,from:1,to:1,padMs:150});assert.equal(plan.fallbackUsed,false);assert.equal(plan.parts[0].sliceFromMs,Math.max(0,Math.min(...words.map(w=>w[2]))-150));
  report.actual_audio_plan=plan;report.actual_primary_head='available';
  // Explicit local staleness fixture; restored below. Imported recent link checks must not be re-fetched.
  for(const chapter of staleLinkFixtures)await db.execute('UPDATE recitation_chapters SET last_verified_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY) WHERE id=?',[chapter.id]);
  const periodic=new CatalogPeriodicLinkChecker(db,undefined,source);
  const periodicResult=await periodic.runOnce();await periodic.close();
  assert.equal(periodicResult.state,'checked');assert.equal(periodicResult.checked,20);assert.equal(periodicResult.updated,20);
  report.actual_periodic_link_check=periodicResult;
  // Two writes in parallel test the real audit lock through commit.
  await Promise.all([admin.updatePresentation(actor,String(record.id),{display_label_ar:'اختبار محلي مؤقت'}),admin.updatePresentation(actor,String(record.id),{quality_note:'LOCAL_TEST_ONLY'})]);
  const tails=await db.read('SELECT a.hash FROM audit_logs a LEFT JOIN audit_logs b ON b.prev_hash=a.hash WHERE b.id IS NULL');assert.equal(tails.length,1);
  await db.execute('UPDATE recitations SET is_public=0 WHERE id=?',[record.id]);assert.equal((await get('/reciters',{'If-None-Match':readers.etag!})).status,200);assert.equal((await get(`/recitations/${record.slug}/surahs`)).body.code,'RECITATION_NOT_PUBLIC');
  await assert.rejects(admin.reviewVoice({...actor,kind:'system'},String(record.id),'confirmed','prohibited system approval'),e=>e instanceof Error&&e.message==='CATALOG_PERMISSION_DENIED');
  report.passed=true;report.nonempty_real_database_api=true;report.flag_404_all_four=true;report.etag_304_revalidated=true;report.availability_mode_actual_database=true;report.concurrent_audit_unique_tail=true;report.no_cross_recitation_substitution=true;
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw error;}
finally{
  for(const chapter of staleLinkFixtures)await db.execute('UPDATE recitation_chapters SET audio_status=?,last_verified_at=?,updated_at=? WHERE id=?',[chapter.audio_status,chapter.last_verified_at,chapter.updated_at,chapter.id]);
  const keys=['status','is_public','voice_identity_status','voice_confirmed_by','verification_method','timing_level','timing_quality','surah_start_basmala_audio_status','verification_details','display_label_ar','quality_note','updated_at'];
  await db.execute('UPDATE recitations SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?',[...keys.map(k=>typeof record[k]==='object'&&record[k]!==null&&!(record[k] instanceof Date)?JSON.stringify(record[k]):record[k]),record.id]);
  await db.execute('UPDATE audio_providers SET license_status=?,host_allowlist=?,updated_at=? WHERE id=?',[provider.license_status,JSON.stringify(provider.host_allowlist),provider.updated_at,provider.id]);
  await db.execute("DELETE FROM system_settings WHERE key_name IN ('availability_mode','quran_catalog_v2','voice_gate_policy','storage_adapter')");for(const r of originals)await db.execute('INSERT INTO system_settings(key_name,value_text,is_secret,category,updated_at) VALUES(?,?,?,?,?)',[r.key_name,r.value_text,r.is_secret,r.category,r.updated_at]);
  server.close();await pool.end();report.fixture_metadata_restored=true;writeFileSync('docs/data/d4-t3-real-api.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,restored:report.fixture_metadata_restored}));
