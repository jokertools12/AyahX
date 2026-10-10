/** Root-only destructive LOCAL constraint rehearsal. Every data probe rolls back. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {D4_PUBLICATION_CONSTRAINT_SQL} from '../server/services/catalogTechnicalPublication';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
const database=option('--local-db');assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true});
const query="SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('chk_catalog_offset','chk_catalog_publish') ORDER BY CONSTRAINT_NAME";
const report:Record<string,unknown>={started_at:new Date().toISOString(),local_only:true};
try{
  assert.equal((await db.query<RowDataPacket[]>('SELECT VERSION() version'))[0][0].version,'9.7.2');
  // CREATE TABLE LIKE renamed the checks in this isolated clone. Restore production names locally.
  const [aliases]=await db.query<RowDataPacket[]>("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('recitations_chk_1','recitations_chk_2') ORDER BY CONSTRAINT_NAME");
  if(aliases.length===2)await db.query(`ALTER TABLE recitations ${aliases.flatMap((a,i)=>[`DROP CHECK ${a.CONSTRAINT_NAME}`,`ADD CONSTRAINT ${i===0?'chk_catalog_offset':'chk_catalog_publish'} CHECK (${String(a.CHECK_CLAUSE).replace(/\\'/gu,"'")})`]).join(',')}`);
  const checks=async()=> (await db.query<RowDataPacket[]>(query))[0].map(r=>({name:String(r.CONSTRAINT_NAME),clause:String(r.CHECK_CLAUSE)}));
  const checksum=async()=> (await db.query<RowDataPacket[]>('CHECKSUM TABLE recitations,ayah_timings,users,user_roles,quran_surahs,quran_ayahs,quran_words'))[0];
  const before=await checksum(),old=await checks();assert.equal(old.length,2);report.old_checks=old;
  await db.query(D4_PUBLICATION_CONSTRAINT_SQL);const after=await checks();
  await db.query(D4_PUBLICATION_CONSTRAINT_SQL);assert.deepEqual(await checks(),after);report.apply_twice=true;report.new_checks=after;
  const [rows]=await db.query<RowDataPacket[]>("SELECT id FROM recitations WHERE slug='ahmed_saud_mp3quran'");assert.equal(rows.length,1);const id=rows[0].id;
  await db.beginTransaction();await db.query("UPDATE recitations SET status='published',audio_mode='surah_slice',timing_quality='verified',timing_level='word',verification_method='v1',offset_verified=1,verification_status='passed',offset_check_score=.99 WHERE id=?",[id]);
  const [basmala]=await db.query<RowDataPacket[]>('SELECT surah_start_basmala_audio_status,voice_identity_status,is_public FROM recitations WHERE id=?',[id]);assert.equal(basmala[0].surah_start_basmala_audio_status,'unverified');assert.equal(basmala[0].voice_identity_status,'unverified');assert.equal(Number(basmala[0].is_public),0);
  const probes=["riwayah_code='warsh_an_nafi'","offset_check_score=.94","offset_check_score=1.1","audio_mode='ayah_clips'","verification_method=NULL","verification_method='v2',verification_details=JSON_OBJECT()"];
  for(const patch of probes)await assert.rejects(()=>db.query(`UPDATE recitations SET ${patch} WHERE id=?`,[id]),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
  await db.rollback();report.invalid_data_rejected=probes.length;report.basmala_unverified_not_fabricated=true;
  const restore=`ALTER TABLE recitations DROP CHECK chk_catalog_offset,DROP CHECK chk_catalog_publish,${old.map(c=>`ADD CONSTRAINT ${c.name} CHECK (${c.clause.replace(/\\'/gu,"'")})`).join(',')};`;
  await db.query(restore);assert.deepEqual(await checks(),old);report.local_rollback=true;
  await db.query(D4_PUBLICATION_CONSTRAINT_SQL);assert.deepEqual(await checks(),after);report.reapply=true;
  assert.deepEqual(await checksum(),before);report.data_checksums_unchanged=true;report.passed=true;
}catch(error){await db.rollback();report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN';throw error;}
finally{await db.end();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,local_rollback:report.local_rollback,invalid_data_rejected:report.invalid_data_rejected}));
