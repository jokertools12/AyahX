/** Root only: activate role permissions AFTER all affected deployed services support them. */
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { activateRenderV2AccessSql } from '../server/db/migrations/007_addRenderManifestV2';
import { ENVIRONMENTS } from './lib/railwayQuranOps';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
assert.ok(process.argv.includes('--activate-after-success'),'EXPLICIT_ACTIVATION_REQUIRED');
const deployments=JSON.parse(await readFile('docs/data/d7-deployment-proof.json','utf8'));
assert.equal(deployments.services.length,4);assert.ok(deployments.services.every((row:{status:string;commit:string})=>row.status==='SUCCESS'&&row.commit===deployments.commit),'FOUR_NEW_SUCCESS_REQUIRED');
const sql=activateRenderV2AccessSql(),digest=createHash('sha256').update(sql.map(row=>row+';').join('\n')+'\n').digest('hex');
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:true});
const proof:Record<string,unknown>={passed:false,deployed_commit:deployments.commit,sql_sha256:digest,started_at:new Date().toISOString()};
try{
 const tables=['users','profiles','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
 const snapshot=()=>session.read('CHECKSUM TABLE '+tables.join(',')+';');
 const before=await snapshot();
 assert.equal((await session.read("SELECT value_text FROM system_settings WHERE key_name='quran_catalog_v2';")).trim(),'false');
 await session.executeStatements(sql.map(row=>({sql:row+';',rowCount:1})));await session.commit();
 assert.equal(await snapshot(),before,'PROTECTED_DATA_CHANGED');
 const roles=(await session.read("SELECT role_slug FROM admin_permissions WHERE permission_key='render.test' ORDER BY role_slug;")).trim().split(/\r?\n/u);
 assert.deepEqual(roles,['admin','super_admin']);Object.assign(proof,{passed:true,roles,protected_checksums_unchanged:true});
}finally{proof.serial=await session.close();proof.finished_at=new Date().toISOString();await writeFile('docs/data/d7-render-lab-activation-proof.json',JSON.stringify(proof,null,2)+'\n');}
console.log(JSON.stringify({passed:proof.passed,roles:proof.roles}));
