import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {D4_OFFSET_CHECK,D4_PUBLISH_CHECK,D4_SLICE_CHECK,PUBLICATION_CONSTRAINTS} from '../../server/services/catalogTechnicalPublication';
import {humanReviewMigrationSql} from '../../server/db/migrations/005_addHumanReviewsAndLicensedSources';
import type {Inventory} from './railwayQuranOps';

export const digest=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');
export const protectedPublicationTables=['users','user_roles','quran_surahs','quran_ayahs','quran_words','ayah_timings','import_jobs','ayah_timing_history'] as const;
/** Identical source fixture DDL binds an existing real rehearsal to the current CHECK implementation. */
export function licensedPublicationFixtureDdl():string{
  return `CREATE TABLE ayahx_d4_licensed_publication_fixture(id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,status VARCHAR(32),riwayah_code VARCHAR(64),canonical_text_available BOOLEAN,audio_mode VARCHAR(32),offset_verified BOOLEAN,offset_check_score DOUBLE,verification_status VARCHAR(32),verification_method VARCHAR(8),verification_details JSON,timing_quality VARCHAR(32),timing_level VARCHAR(32),licensed_publication_details JSON,CONSTRAINT chk_fixture_catalog_offset CHECK(${D4_OFFSET_CHECK}),CONSTRAINT chk_fixture_scoped_publication CHECK(${D4_PUBLISH_CHECK}),CONSTRAINT chk_fixture_scoped_slice CHECK(${D4_SLICE_CHECK})) ENGINE=InnoDB`;
}
export interface LicensedRehearsal {
  passed:boolean;scope:string;database:string;production_written:boolean;
  migration_up_twice:boolean;column_nullable_json:boolean;global_offset_unchanged:boolean;
  catalog_branch_unchanged:boolean;local_column_down_reapply:boolean;
  down005_twice_and_reapply_with_dependent_check:boolean;
  rejections:Array<{code:string}>;expected_clauses:Record<string,string>;
  legacy_slice_clauses:string[];slice_branch_tests_passed:boolean;
  ddl_sha256:string;migration_sql_sha256:string;
}
export function acceptedLicensedClauses(report:LicensedRehearsal):Record<string,string>{
  assert.ok(report.passed===true&&report.scope==='local_synthetic_scratch_only'&&report.production_written===false&&/^ayahx_d4_[a-z0-9_]+$/u.test(report.database),'LICENSED_LOCAL_REHEARSAL_REQUIRED');
  for(const key of ['migration_up_twice','column_nullable_json','global_offset_unchanged','catalog_branch_unchanged','local_column_down_reapply','down005_twice_and_reapply_with_dependent_check'] as const)assert.equal(report[key],true,'LICENSED_REHEARSAL_GATE:'+key);
  assert.ok(Array.isArray(report.rejections)&&report.rejections.length>=23&&report.rejections.every(r=>r.code==='ER_CHECK_CONSTRAINT_VIOLATED'),'LICENSED_23_REJECTIONS_REQUIRED');
  assert.equal(report.ddl_sha256,digest(licensedPublicationFixtureDdl()),'LICENSED_REHEARSED_CHECK_SOURCE_CHANGED');
  assert.equal(report.migration_sql_sha256,digest(humanReviewMigrationSql().join('\n')),'LICENSED_REHEARSED_MIGRATION_CHANGED');
  assert.deepEqual(Object.keys(report.expected_clauses??{}).sort(),Object.keys(PUBLICATION_CONSTRAINTS).sort(),'LICENSED_EXPECTED_CHECK_NAMES_REQUIRED');
  for(const clause of Object.values(report.expected_clauses))assert.ok(typeof clause==='string'&&clause.length>0,'LICENSED_EXPECTED_CHECK_CLAUSE_REQUIRED');
  assert.ok(report.slice_branch_tests_passed===true&&Array.isArray(report.legacy_slice_clauses)&&report.legacy_slice_clauses.length>0&&report.legacy_slice_clauses.every(c=>typeof c==='string'&&c.length>0),'LICENSED_SLICE_BRANCH_REHEARSAL_REQUIRED');
  return report.expected_clauses;
}
/** Preserve parentheses, literal case, escaped strings, and token boundaries. */
export function exactCheckText(value:string):string{
  // CHECK_CLAUSE may serialize literal delimiters as \\'. Keep this canonical
  // representation byte-for-byte; it must never be decoded or approximated.
  if(value.includes("\\'"))return value.trim();
  let quote='',out='',pendingSpace=false;
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(quote){out+=c;if(c==='\\'&&i+1<value.length)out+=value[++i];else if(c===quote){if(value[i+1]===quote)out+=value[++i];else quote='';}}
    else if(/\s/u.test(c))pendingSpace=true;
    else{if(pendingSpace&&out&&/[a-z0-9_$]/iu.test(out.at(-1)!)&&/[a-z0-9_$]/iu.test(c))out+=' ';pendingSpace=false;out+=c;if(c==="'"||c==='"'||c==='`')quote=c;}
  }
  assert.equal(quote,'','UNTERMINATED_CHECK_LITERAL');return out;
}
export function assertExpectedCheckClauses(actual:Record<string,string>,expected:Record<string,string>,legacySliceClauses:readonly string[]=[]):void{
  for(const [name,clause]of Object.entries(expected))assert.equal(exactCheckText(actual[name]??''),exactCheckText(clause),'CHECK_READBACK_CHANGED:'+name);
  assert.ok(!('chk_catalog_offset'in actual)&&!('chk_catalog_publish'in actual)&&!('chk_catalog_slice'in actual),'LEGACY_CHECK_STILL_PRESENT');
  for(const [name,clause]of Object.entries(actual))if(/^(?:chk_catalog_slice|recitations_chk_\d+)$/u.test(name))assert.ok(!legacySliceClauses.includes(clause),'LEGACY_SLICE_STILL_PRESENT:'+name);
}
/** Replace only reviewed CHECKs whose canonical MySQL text actually differs. */
export function licensedPublicationConstraintSql(actual:Record<string,string>,expected:Record<string,string>,legacySliceClauses:readonly string[]=[]):string[]{
  assert.deepEqual(Object.keys(expected).sort(),Object.keys(PUBLICATION_CONSTRAINTS).sort(),'EXPECTED_CONSTRAINT_NAMES_CHANGED');
  const changed=Object.keys(PUBLICATION_CONSTRAINTS).filter(name=>name in actual&&exactCheckText(actual[name])!==exactCheckText(expected[name]));
  const legacyNames=Object.keys(actual).filter(name=>/^(?:chk_catalog_slice|recitations_chk_\d+)$/u.test(name)&&legacySliceClauses.includes(actual[name]));
  if('chk_catalog_slice'in actual&&!legacyNames.includes('chk_catalog_slice'))throw new Error('LEGACY_SLICE_CANONICAL_EVIDENCE_REQUIRED');
  const removed=['chk_catalog_offset','chk_catalog_publish',...legacyNames,...changed].filter(name=>name in actual).map(name=>`DROP CHECK ${name}`);
  const added=Object.entries(PUBLICATION_CONSTRAINTS).filter(([name])=>!(name in actual)||changed.includes(name)).map(([name,clause])=>`ADD CONSTRAINT ${name} CHECK (${clause})`);
  return removed.length||added.length?[`ALTER TABLE recitations ${[...removed,...added].join(', ')};`]:[];
}
export interface PublicationBackup {
  restored_and_verified:boolean;mysql_version:string;checked_at:string;encrypted_path:string;encrypted_sha256:string;
  restored_tables:number;row_counts:Record<string,number>;checksums:Record<string,string|null>;
}
export function assertFreshPublicationBackup(backup:PublicationBackup,nowMs:number):void{
  const time=Date.parse(backup.checked_at);
  assert.ok(backup.restored_and_verified===true&&backup.mysql_version==='9.7.2'&&Number.isFinite(time)&&time<=nowMs&&nowMs-time<86400000,'FRESH_VERIFIED_BACKUP_REQUIRED');
  assert.match(backup.encrypted_sha256,/^[a-f0-9]{64}$/u,'ENCRYPTED_BACKUP_SHA_REQUIRED');
}
export function assertPublicationInventory(before:Inventory,baseline:Inventory,backup:PublicationBackup):void{
  assert.equal(before.server_uuid,baseline.server_uuid,'SERVER_ID_CHANGED');
  assert.equal(before.canonical_checksum,baseline.canonical_checksum,'CANONICAL_TEXT_CHANGED');assert.deepEqual(before.d1_counts,baseline.d1_counts,'D1_COUNTS_CHANGED');
  const names=before.tables.map(t=>t.name).sort();
  assert.deepEqual(Object.keys(before.row_counts).sort(),names,'INVENTORY_TABLE_SET_INCOMPLETE');
  assert.deepEqual(Object.keys(backup.row_counts).sort(),names,'BACKUP_TABLE_SET_CHANGED');
  assert.deepEqual(Object.keys(backup.checksums).sort(),names,'BACKUP_CHECKSUM_SET_INCOMPLETE');
  assert.equal(backup.restored_tables,names.length,'BACKUP_TABLE_COUNT_CHANGED');
  assert.deepEqual(before.row_counts,backup.row_counts,'FRESH_BACKUP_COUNTS_CHANGED');
  assert.deepEqual(before.checksums,backup.checksums,'FRESH_BACKUP_CHECKSUMS_CHANGED');
  for(const table of protectedPublicationTables){assert.ok(baseline.checksums[table]!=null&&before.checksums[table]!=null,'PROTECTED_CHECKSUM_UNAVAILABLE:'+table);assert.equal(before.checksums[table],baseline.checksums[table],'PROTECTED_CHECKSUM_STOP:'+table);}
}
export function assertPublicationDdlUnchanged(before:Record<string,string>,after:Record<string,string>):void{
  assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort(),'DDL_TABLE_SET_CHANGED');
  for(const name of Object.keys(before))if(name!=='recitations')assert.equal(after[name],before[name],'UNEXPECTED_DDL_CHANGE:'+name);
}
