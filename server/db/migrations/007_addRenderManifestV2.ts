/** D7: explicit additive migration. Application startup never calls this file. */
import {createHash} from 'node:crypto';
const lit=(value:string)=>"'"+value.replace(/'/gu,"''")+"'";
const text=(type:string)=>`${type} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL`;
export const renderV2Columns={
  recitation_id:text('VARCHAR(36)'),audio_plan_hash:text('CHAR(64)'),timing_version_hash:text('CHAR(64)'),
  audio_mode_used:text('VARCHAR(32)'),fallback_used:'BOOLEAN DEFAULT NULL',audio_bytes_fetched:'BIGINT UNSIGNED DEFAULT NULL',
  audio_provider_code:text('VARCHAR(64)'),qa_report_json:'JSON DEFAULT NULL',
} as const;
const condition=(name:string,absent:string,present='SELECT 1')=>`SET @ayahx_d7_ddl=(SELECT IF(COUNT(*)=0,${lit(absent)},${lit(present)}) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='render_jobs' AND COLUMN_NAME=${lit(name)}); PREPARE ayahx_d7_stmt FROM @ayahx_d7_ddl; EXECUTE ayahx_d7_stmt; DEALLOCATE PREPARE ayahx_d7_stmt`;
export const renderTestPermissionId=(role:string)=>'d7:'+createHash('sha256').update(role+':render.test').digest('hex').slice(0,32);
export function renderV2MigrationSql():string[]{
  return [
    ...Object.entries(renderV2Columns).map(([name,definition])=>condition(name,`ALTER TABLE render_jobs ADD COLUMN ${name} ${definition}`)),
    "INSERT IGNORE INTO permissions(permission_key,description) VALUES('render.test','اختبار الريندر الحقيقي: super_admin وadmin فقط')",
  ];
}
/** Explicit second step AFTER app replicas support render.test. Never a startup seed. */
export function activateRenderV2AccessSql():string[]{return ['super_admin','admin'].map(role=>`INSERT IGNORE INTO admin_permissions(id,role_slug,resource,action,permission_key) SELECT ${lit(renderTestPermissionId(role))},${lit(role)},'render','test','render.test' FROM admin_roles WHERE slug=${lit(role)} AND NOT EXISTS(SELECT 1 FROM admin_permissions WHERE role_slug=${lit(role)} AND permission_key='render.test')`);}
export async function activateRenderV2Access(db:{query(sql:string):Promise<unknown>}):Promise<void>{for(const sql of activateRenderV2AccessSql())await db.query(sql);}
export async function upRenderV2(db:{query(sql:string):Promise<unknown>}):Promise<void>{for(const sql of renderV2MigrationSql())await db.query(sql);}
/** Destructive rollback is allowed only on a disposable local restored schema. */
export async function downRenderV2(db:{query(sql:string):Promise<unknown>},scope:'local-rehearsal'):Promise<void>{
  if(scope!=='local-rehearsal')throw new Error('DESTRUCTIVE_REHEARSAL_ONLY');
  await db.query("DELETE FROM admin_permissions WHERE id IN ("+['super_admin','admin'].map(role=>lit(renderTestPermissionId(role))).join(',')+")");
  await db.query("DELETE FROM permissions WHERE permission_key='render.test'");
  for(const name of Object.keys(renderV2Columns))await db.query(condition(name,'SELECT 1',`ALTER TABLE render_jobs DROP COLUMN ${name}`));
}
