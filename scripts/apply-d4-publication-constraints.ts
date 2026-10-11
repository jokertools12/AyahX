/** Root-only reviewed scoped CHECK replacement. Defaults to read-only dry-run. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {captureInventory,ENVIRONMENTS,identifier,type Inventory} from './lib/railwayQuranOps';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {acceptedLicensedClauses,assertExpectedCheckClauses,assertFreshPublicationBackup,assertPublicationDdlUnchanged,assertPublicationInventory,digest,licensedPublicationConstraintSql,type LicensedRehearsal,type PublicationBackup} from './lib/d4PublicationAcceptance';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
assert.equal(option('--target'),'production');const apply=process.argv.includes('--apply');if(apply)assert.ok(process.argv.includes('--confirm-production'));
const baseline=JSON.parse(readFileSync(option('--baseline'),'utf8')) as Inventory;
const backup=JSON.parse(readFileSync(option('--backup'),'utf8')) as PublicationBackup;
const rehearsalBytes=readFileSync(option('--licensed-rehearsal'));
const rehearsal=JSON.parse(rehearsalBytes.toString('utf8')) as LicensedRehearsal;
const expected=acceptedLicensedClauses(rehearsal),legacySliceClauses=rehearsal.legacy_slice_clauses;
const rehearsalSha=digest(rehearsalBytes);
assertFreshPublicationBackup(backup,Date.now());assert.equal(digest(readFileSync(backup.encrypted_path)),backup.encrypted_sha256,'ENCRYPTED_BACKUP_CHANGED');
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:apply});
const report:Record<string,unknown>={started_at:new Date().toISOString(),target:'production',applied:apply,licensed_rehearsal_sha256:rehearsalSha,encrypted_backup_sha256:backup.encrypted_sha256,expected_clauses:expected};
try{
  const before=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));assertPublicationInventory(before,baseline,backup);
  assert.ok(before.columns.some(c=>c.table==='recitations'&&c.column==='licensed_publication_details'&&c.type==='json'),'LICENSED_SCHEMA_AUGMENTATION_REQUIRED');
  const checks=async()=>{
    const rows=JSON.parse((await session.read("SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('name',t.CONSTRAINT_NAME,'clause',c.CHECK_CLAUSE,'enforced',t.ENFORCED)),JSON_ARRAY()) FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.CONSTRAINT_SCHEMA=DATABASE() AND t.TABLE_NAME='recitations' AND t.CONSTRAINT_TYPE='CHECK';")).trim()) as Array<{name:string;clause:string;enforced:string}>;
    assert.equal(new Set(rows.map(r=>r.name)).size,rows.length,'DUPLICATE_CHECK_NAME');
    for(const row of rows)assert.ok(typeof row.clause==='string'&&row.clause.length>0&&row.enforced==='YES','UNENFORCED_OR_MISSING_CHECK:'+row.name);
    return Object.fromEntries(rows.map(r=>[r.name,r.clause]));
  };
  const ddlHashes=async(inventory:Inventory)=>{
    const result:Record<string,string>={};
    for(const name of inventory.tables.map(t=>t.name).sort()){
      const raw=await session.read(`SHOW CREATE TABLE ${identifier(name)};`),separator=raw.indexOf('\t');
      assert.ok(separator>0,'DDL_READBACK_REQUIRED:'+name);result[name]=digest(raw.slice(separator+1).trimEnd());
    }
    return result;
  };
  const actual=await checks(),ddlBefore=await ddlHashes(before);
  const statements=licensedPublicationConstraintSql(actual,expected,legacySliceClauses),sql=statements.join('\n')+'\n',sha=digest(sql);
  if(apply){
    const dry=JSON.parse(readFileSync(option('--dry-run'),'utf8')) as Record<string,unknown>;
    assert.ok(dry.passed===true&&dry.applied===false&&dry.target==='production','APPROVED_DRY_RUN_REQUIRED');
    assert.equal(dry.sql_sha256,sha,'DRY_PLAN_CHANGED');assert.equal(dry.licensed_rehearsal_sha256,rehearsalSha,'DRY_REHEARSAL_CHANGED');
    assert.equal(dry.encrypted_backup_sha256,backup.encrypted_sha256,'DRY_BACKUP_CHANGED');assert.equal(dry.server_uuid,before.server_uuid,'DRY_SERVER_CHANGED');
    assert.deepEqual(dry.checks_before,actual,'CHECK_CHANGED_SINCE_DRY_RUN');assert.deepEqual(dry.ddl_checksums_before,ddlBefore,'DDL_CHANGED_SINCE_DRY_RUN');
  }
  Object.assign(report,{server_uuid:before.server_uuid,sql_sha256:sha,sql_bytes:Buffer.byteLength(sql),statements:statements.length,checks_before:actual,ddl_checksums_before:ddlBefore,backup_tables_verified:before.tables.length,row_counts_before:before.row_counts,checksums_before:before.checksums,disk_before:await session.storage()});
  if(apply&&statements.length){
    await session.executeStatements(statements.map(sql=>({sql,rowCount:0})),async()=>{assertFreshPublicationBackup(backup,Date.now());const disk=await session.storage();assert.ok(disk.total_bytes>0&&disk.available_bytes/disk.total_bytes>=.2,'D4_SPACE_GUARD');});await session.commit();
  }
  const after=apply?await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql)):before;
  assert.deepEqual(after.row_counts,before.row_counts);assert.deepEqual(after.checksums,before.checksums,'DDL_CHANGED_CELLS');assert.deepEqual(after.critical_counts,before.critical_counts);
  assert.deepEqual(after.columns,before.columns,'CHECK_OPERATION_CHANGED_COLUMNS');assert.deepEqual(after.foreign_keys,before.foreign_keys,'CHECK_OPERATION_CHANGED_FOREIGN_KEYS');
  const actualAfter=apply?await checks():actual,ddlAfter=apply?await ddlHashes(after):ddlBefore;
  assertPublicationDdlUnchanged(ddlBefore,ddlAfter);if(apply)assertExpectedCheckClauses(actualAfter,expected,legacySliceClauses);
  Object.assign(report,{passed:true,protected_unchanged:true,d1:after.d1_counts,d3:after.row_counts.ayah_timings,canonical_checksum:after.canonical_checksum,checks_after:actualAfter,ddl_checksums_after:ddlAfter,row_counts_after:after.row_counts,checksums_after:after.checksums,disk_after:await session.storage()});
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'K1_PRODUCTION_FAILED';throw new Error(String(report.failure));}
finally{report.serial=await session.close();report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,applied:apply,sql_sha256:report.sql_sha256}));
