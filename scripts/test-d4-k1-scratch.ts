/** Root-owned isolated scratch database, no CREATE TABLE LIKE or production writes. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {PUBLICATION_CONSTRAINTS,publicationConstraintSql} from '../server/services/catalogTechnicalPublication';
const database='ayahx_d4_k1_scratch_20261010';
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',charset:'utf8mb4',multipleStatements:true});
const report:Record<string,unknown>={started_at:new Date().toISOString(),local_only:true,new_attempt:1,diagnosis:'COALESCE is numeric, not a boolean AST; clone renames schema-wide constraint symbols. Explicit boolean comparisons in a new scratch schema.',source:'https://dev.mysql.com/doc/refman/9.7/en/create-table-check-constraints.html'};
try{
  assert.equal((await db.query<RowDataPacket[]>('SELECT VERSION() v'))[0][0].v,'9.7.2');
  await db.query(`CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);await db.query(`USE ${database}`);
  await db.query("CREATE TABLE IF NOT EXISTS recitations(id INT PRIMARY KEY,status VARCHAR(32) NOT NULL,riwayah_code VARCHAR(32),canonical_text_available BOOLEAN,audio_mode VARCHAR(32),offset_verified BOOLEAN,verification_status VARCHAR(32),verification_method VARCHAR(16),offset_check_score DOUBLE,verification_details JSON,timing_quality VARCHAR(32),timing_level VARCHAR(16)) ENGINE=InnoDB");
  await db.query('DELETE FROM recitations');
  const checks=async()=> (await db.query<RowDataPacket[]>('SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY CONSTRAINT_NAME'))[0].map(r=>({name:String(r.CONSTRAINT_NAME),clause:String(r.CHECK_CLAUSE)}));
  const up=async()=>{for(const sql of publicationConstraintSql((await checks()).map(c=>c.name)))await db.query(sql);};
  await up();const once=await checks();await up();assert.deepEqual(await checks(),once);report.up_twice=true;
  await db.query("INSERT INTO recitations VALUES(1,'published','hafs_an_asim',1,'surah_slice',1,'passed','v1',.96,JSON_OBJECT(),'verified','word')");report.v1_accepted=true;
  const probes=["riwayah_code=NULL","riwayah_code='warsh_an_nafi'","canonical_text_available=NULL","canonical_text_available=0","audio_mode=NULL","audio_mode='ayah_clips'","offset_verified=0","verification_status=NULL","verification_status='failed'","verification_method=NULL","verification_method='v1',offset_check_score=.949999997","offset_check_score=NULL","offset_check_score=1.01","timing_quality=NULL","timing_quality='aligned'","timing_level=NULL","timing_level='ayah'","verification_method='v2',verification_details=NULL","verification_method='v2',verification_details=JSON_OBJECT()"];
  for(const patch of probes)await assert.rejects(()=>db.query('UPDATE recitations SET '+patch+' WHERE id=1'),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='ER_CHECK_CONSTRAINT_VIOLATED');report.missing_conditions_rejected=probes.length;
  const accepted=JSON.parse(readFileSync('docs/data/d3-offset-v2-accepted.json','utf8')).accepted.ahmed_saud_mp3quran;
  await db.query("UPDATE recitations SET verification_method='v2',offset_check_score=?,verification_details=? WHERE id=1",[accepted.offset_check_score,JSON.stringify({v2_acceptance:accepted})]);report.v2_accepted=true;
  const bad=[{sample_count:4},{sample_count:5.1},{minimum_VAD_agreement:.89},{maximum_absolute_lag_ms:30.01},{maximum_duration_difference_ms:30.01},{review_blockers:['blocked']},{cause:'unknown'},{decision:null}];
  for(const patch of bad)await assert.rejects(()=>db.query('UPDATE recitations SET verification_details=? WHERE id=1',[JSON.stringify({v2_acceptance:{...accepted,...patch}})]),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='ER_CHECK_CONSTRAINT_VIOLATED');report.v2_bad_evidence_rejected=bad.length;
  const before=(await db.query<RowDataPacket[]>('CHECKSUM TABLE recitations'))[0];
  for(const name of Object.keys(PUBLICATION_CONSTRAINTS))await db.query('ALTER TABLE recitations DROP CHECK '+name);assert.deepEqual(await checks(),[]);report.down=true;
  await up();assert.deepEqual(await checks(),once);assert.deepEqual((await db.query<RowDataPacket[]>('CHECKSUM TABLE recitations'))[0],before);report.reapply=true;report.new_checks=once;report.passed=true;
}catch(error){report.passed=false;report.failure=error&&typeof error==='object'&&'code' in error?String(error.code):error instanceof Error?error.message:'UNKNOWN';throw new Error('K1_SCRATCH_FAILED:'+report.failure);}
finally{await db.end();report.finished_at=new Date().toISOString();writeFileSync('docs/data/d4-k1-scratch.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,up_twice:report.up_twice,down:report.down,reapply:report.reapply,rejected:Number(report.missing_conditions_rejected)+Number(report.v2_bad_evidence_rejected)}));
