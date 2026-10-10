/** Root-run disposable local rehearsal only. No Railway import or production path. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import {humanReviewMigrationSql,upHumanReviewsAndLicensedSources,downHumanReviewsAndLicensedSources,licensedSourceColumns,licensedSourceTables} from '../server/db/migrations/005_addHumanReviewsAndLicensedSources';
import {canonicalAuditJson} from '../server/services/catalogAudit';
const option=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
const database=option('--local-db');assert.match(database,/^ayahx_d4_[a-z0-9_]+$/u);
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database,charset:'utf8mb4',multipleStatements:true,dateStrings:true});
const rows=async(sql:string,params:unknown[]=[])=>{const [result]=await db.query<RowDataPacket[]>(sql,params);return result;};
const safe=(name:string)=>{assert.match(name,/^[a-z_]+$/u);return '`'+name+'`';};
const report:Record<string,unknown>={target:'local',database,production_writes:0,started_at:new Date().toISOString()};
try{
  await db.query("SET time_zone='+00:00'");const [{version}]=await rows('SELECT VERSION() version');assert.equal(version,'9.7.2');
  const beforeTables=(await rows('SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME')).map(r=>String(r.name));
  assert.ok(!licensedSourceTables.some(t=>beforeTables.includes(t)),'FRESH_005_REHEARSAL_REQUIRED');
  const altered=Object.keys(licensedSourceColumns);
  const originalFields:Record<string,string[]>={};for(const table of altered)originalFields[table]=(await rows('SELECT COLUMN_NAME name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[table])).map(r=>String(r.name));
  const projection=async(table:string)=>{
    const columns=originalFields[table];const projectionSql=columns.flatMap(name=>["'"+name+"'",safe(name)]).join(',');
    const result=await rows(`SELECT JSON_OBJECT(${projectionSql}) record FROM ${safe(table)} ORDER BY id`);
    return createHash('sha256').update(canonicalAuditJson(result.map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record))).digest('hex');
  };
  const projected=Object.fromEntries(await Promise.all(altered.map(async table=>[table,await projection(table)])));
  const protectedTables=['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history','recitation_chapters'];
  assert.ok(protectedTables.every(t=>beforeTables.includes(t)),'PROTECTED_REHEARSAL_TABLE_MISSING');
  const checks=async()=>Object.fromEntries((await rows('CHECKSUM TABLE '+protectedTables.map(safe).join(','))).map(r=>[String(r.Table).split('.').pop(),String(r.Checksum)]));
  const checksums=await checks();
  const foreignKeys=async()=>canonicalAuditJson(await rows('SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,COLUMN_NAME'));
  const originalForeignKeys=await foreignKeys();
  const counts=async()=>Object.fromEntries((await rows(beforeTables.map(table=>`SELECT '${table}' name,COUNT(*) count FROM ${safe(table)}`).join(' UNION ALL '))).map(r=>[String(r.name),Number(r.count)]));
  const originalCounts=await counts();
  const preserved=async()=>{assert.deepEqual(await checks(),checksums,'PROTECTED_CHECKSUM_CHANGED');assert.deepEqual(await counts(),originalCounts,'ORIGINAL_ROW_COUNTS_CHANGED');for(const table of altered)assert.equal(await projection(table),projected[table],'ORIGINAL_COLUMN_PROJECTION_CHANGED:'+table);assert.equal(await foreignKeys(),originalForeignKeys,'FOREIGN_KEYS_CHANGED');};
  const ddl=humanReviewMigrationSql().map(s=>s+';').join('\n')+'\n';const ddlSha=createHash('sha256').update(ddl).digest('hex');
  const sqlPath=resolve(option('--sql-output')),outside=relative(process.cwd(),sqlPath);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_SQL_REQUIRED');writeFileSync(sqlPath,ddl);
  Object.assign(report,{sql_sha256:ddlSha,sql_bytes:Buffer.byteLength(ddl),before_tables:beforeTables.length,original_counts:originalCounts,original_column_projection_sha256:projected,protected_checksums:checksums});
  await upHumanReviewsAndLicensedSources(db);await upHumanReviewsAndLicensedSources(db);await preserved();
  const columns=await rows('SELECT TABLE_NAME table_name,COLUMN_NAME column_name,COLUMN_TYPE column_type,IS_NULLABLE is_nullable,CHARACTER_SET_NAME charset,COLLATION_NAME collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION');
  for(const [table,fields]of Object.entries(licensedSourceColumns))for(const [name,definition]of Object.entries(fields)){const c=columns.find(c=>c.table_name===table&&c.column_name===name);assert.ok(c,'ADDED_COLUMN_MISSING');assert.equal(c.is_nullable,'YES');if(definition.includes('CHARACTER SET')){assert.equal(c.charset,'utf8mb4');assert.equal(c.collation,definition.includes('utf8mb4_bin')?'utf8mb4_bin':'utf8mb4_unicode_ci');}}
  for(const table of licensedSourceTables){const cols=columns.filter(c=>c.table_name===table);assert.ok(cols.length);for(const c of cols)if(c.charset)assert.ok(c.charset==='utf8mb4'&&['utf8mb4_unicode_ci','utf8mb4_bin'].includes(c.collation),'NEW_TABLE_COLLATION_INVALID');}
  const voice=columns.find(c=>c.table_name==='recitations'&&c.column_name==='voice_identity_status');assert.ok(voice?.column_type.includes("'auto_verified'"));
  const url=columns.find(c=>c.table_name==='recitation_source_urls'&&c.column_name==='url');assert.equal(url?.is_nullable,'YES');assert.equal(url?.collation,'utf8mb4_bin');
  report.migration_twice=true;report.collation_and_nullability_verified=true;
  await downHumanReviewsAndLicensedSources(db,'local-rehearsal');await downHumanReviewsAndLicensedSources(db,'local-rehearsal');await preserved();report.down_twice=true;
  const afterDown=(await rows('SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME')).map(r=>String(r.name));assert.deepEqual(afterDown,beforeTables,'DOWN_TABLE_SET_CHANGED');
  await upHumanReviewsAndLicensedSources(db);await preserved();report.reapply=true;report.original_columns_unchanged=true;report.protected_unchanged=true;report.after_tables=beforeTables.length+licensedSourceTables.length;report.passed=true;
}catch(error){report.passed=false;report.failure=error&&typeof error==='object'&&'code'in error?String(error.code):'MIGRATION005_LOCAL_REHEARSAL_FAILED';throw new Error(String(report.failure));}
finally{await db.end();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,migration_twice:report.migration_twice,down_twice:report.down_twice,reapply:report.reapply,sql_sha256:report.sql_sha256}));
