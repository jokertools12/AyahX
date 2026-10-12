/** Root-only post-lab verification. Existing accounts/canonical/timing data must remain exact. */
import assert from 'node:assert/strict';
import { readFile,readdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { captureInventory,ENVIRONMENTS,identifier } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
const before=JSON.parse(await readFile(process.env.LOCALAPPDATA+'/AyahX/private-backups/d7-production-refresh-before.json','utf8'));
const migration=JSON.parse(await readFile('docs/data/d7-production-migration-proof.json','utf8'));
const files=(await readdir('docs/data')).filter(file=>/^d7-production-.*\.json$/u.test(file));
const jobs=[];
for(const file of files){const proof=JSON.parse(await readFile('docs/data/'+file,'utf8'));if(proof.scope==='RAILWAY_PRODUCTION_RENDER_LAB_REAL_QUEUE'&&proof.job_id)jobs.push(proof.job_id);}
assert.equal(new Set(jobs).size,jobs.length,'UNIQUE_ROOT_LAB_JOBS_REQUIRED');
const session=await openRailwayMysqlSession(ENVIRONMENTS.production);
const proof:Record<string,unknown>={passed:false,started_at:new Date().toISOString(),production_writes:0};
try{
 const after=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));
 const immutable=['users','profiles','subscriptions','payment_requests','saved_videos','system_settings','user_roles','notifications','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
 for(const table of immutable){assert.equal(after.row_counts[table],before.row_counts[table],'PROTECTED_ROW_COUNT_CHANGED:'+table);assert.equal(after.checksums[table],before.checksums[table],'PROTECTED_CHECKSUM_CHANGED:'+table);}
 assert.deepEqual(after.d1_counts,{surahs:114,ayahs:6236,words:77433});assert.equal(after.row_counts.ayah_timings,422463);assert.equal(after.canonical_checksum,migration.canonical_checksum);
 const columns=before.columns.filter((row:{table:string})=>row.table==='render_jobs').map((row:{column:string})=>row.column);
 const originalSql="SELECT SHA2(CAST(JSON_OBJECT("+columns.flatMap((name:string)=>["'"+name+"'",identifier(name)]).join(',')+") AS CHAR CHARACTER SET utf8mb4),256) FROM render_jobs WHERE created_at<'2026-10-11 21:00:00' ORDER BY id;";
 const originalHash=createHash('sha256').update(await session.read(originalSql)).digest('hex');assert.equal(originalHash,migration.original_render_job_columns_sha256,'ORIGINAL_RENDER_JOBS_CHANGED');
 assert.equal(after.row_counts.render_jobs,before.row_counts.render_jobs+jobs.length,'ONLY_DOCUMENTED_LAB_ROWS_ALLOWED');
 assert.equal((await session.read("SELECT value_text FROM system_settings WHERE key_name='quran_catalog_v2';")).trim(),'false');
 const grants=(await session.read("SELECT role_slug FROM admin_permissions WHERE permission_key='render.test' ORDER BY role_slug;")).trim().split(/\r?\n/u);assert.deepEqual(grants,['admin','super_admin']);
 const auditCount=Number((await session.read("SELECT COUNT(*) FROM audit_logs WHERE action='render_lab.job_created' AND created_at>='2026-10-11 21:00:00';")).trim());assert.equal(auditCount,jobs.length,'ONE_CREATION_AUDIT_PER_JOB');
 Object.assign(proof,{passed:true,d1:after.d1_counts,d3:after.row_counts.ayah_timings,canonical_checksum:after.canonical_checksum,critical_before:before.critical_counts,critical_after:after.critical_counts,immutable_tables:immutable,immutable_checksums_unchanged:true,original_render_jobs_sha256:originalHash,new_lab_job_count:jobs.length,creation_audit_count:auditCount,catalog_flag:false,roles:grants,disk:await session.storage()});
}finally{proof.serial=await session.close();proof.finished_at=new Date().toISOString();await writeFile('docs/data/d7-final-integrity-proof.json',JSON.stringify(proof,null,2)+'\n');}
console.log(JSON.stringify({passed:proof.passed,new_lab_job_count:proof.new_lab_job_count,d1:proof.d1,d3:proof.d3}));
