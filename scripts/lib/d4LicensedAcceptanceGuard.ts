import assert from 'node:assert/strict';
/** No configurable host/port: this root-run destructive rehearsal is local only. */
export function assertLicensedAcceptanceDatabases(database:string,template:string):void{
  assert.match(database,/^ayahx_d4_licensed_acceptance_[a-z0-9_]+$/u,'NEW_DISPOSABLE_DATABASE_REQUIRED');
  assert.match(template,/^ayahx_d[234]_[a-z0-9_]+$/u,'LOCAL_TEMPLATE_REQUIRED');
  assert.notEqual(database,template,'TEMPLATE_MUST_REMAIN_READ_ONLY');
}
export function assertLocalCloneDdl(ddl:string,template:string):void{
  assert.ok(/^CREATE TABLE /u.test(ddl),'BASE_TABLE_DDL_REQUIRED');
  assert.ok(!ddl.includes('`'+template+'`.')&&!/\bREFERENCES\s+(?:`[^`]+`|[a-z0-9_]+)\s*\./iu.test(ddl),'CROSS_SCHEMA_REFERENCE_PROHIBITED');
}
