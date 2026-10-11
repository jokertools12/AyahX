import {describe,it,expect} from 'vitest';
import {acceptedLicensedClauses,assertExpectedCheckClauses,assertFreshPublicationBackup,assertPublicationDdlUnchanged,assertPublicationInventory,digest,exactCheckText,licensedPublicationFixtureDdl,licensedPublicationConstraintSql,protectedPublicationTables,type LicensedRehearsal,type PublicationBackup} from '../../scripts/lib/d4PublicationAcceptance';
import {humanReviewMigrationSql} from '../../server/db/migrations/005_addHumanReviewsAndLicensedSources';
import {PUBLICATION_CONSTRAINTS} from '../../server/services/catalogTechnicalPublication';
import type {Inventory} from '../../scripts/lib/railwayQuranOps';
import {assertScopedPublicationMetadata} from '../../scripts/lib/d4PublicationMetadataGuard';
import {d4Literal} from '../../scripts/lib/d4AuditSqlPlan';
const rehearsal=():LicensedRehearsal=>({passed:true,scope:'local_synthetic_scratch_only',database:'ayahx_d4_unit',production_written:false,migration_up_twice:true,column_nullable_json:true,global_offset_unchanged:true,catalog_branch_unchanged:true,local_column_down_reapply:true,down005_twice_and_reapply_with_dependent_check:true,slice_branch_tests_passed:true,legacy_slice_clauses:['exact old slice canonical'],rejections:Array.from({length:23},()=>({code:'ER_CHECK_CONSTRAINT_VIOLATED'})),expected_clauses:{...PUBLICATION_CONSTRAINTS},ddl_sha256:digest(licensedPublicationFixtureDdl()),migration_sql_sha256:digest(humanReviewMigrationSql().join('\n'))});
const now=Date.parse('2026-10-11T12:00:00Z');
const names=[...protectedPublicationTables,'recitations','arbitrary_table'];
const inventory=():Inventory=>({server_uuid:'uuid',canonical_checksum:'legal',d1_counts:{surahs:114,ayahs:6236,words:77433},tables:names.map(name=>({name,collation:'utf8mb4_unicode_ci',engine:'InnoDB',row_format:'Dynamic'})),row_counts:Object.fromEntries(names.map(name=>[name,1])),checksums:Object.fromEntries(names.map(name=>[name,'100']))} as Inventory);
const backup=():PublicationBackup=>({restored_and_verified:true,mysql_version:'9.7.2',checked_at:new Date(now-1000).toISOString(),encrypted_path:'private.age',encrypted_sha256:'a'.repeat(64),restored_tables:names.length,row_counts:{...inventory().row_counts},checksums:{...inventory().checksums}});
describe('scoped CHECK production gates (units only)',()=>{
  it('accepts only the current source-bound local licensed rehearsal',()=>expect(acceptedLicensedClauses(rehearsal())).toEqual(PUBLICATION_CONSTRAINTS));
  it.each([{passed:false},{production_written:true},{scope:'production'},{database:'railway'},{down005_twice_and_reapply_with_dependent_check:false},{global_offset_unchanged:false},{ddl_sha256:'old-check'},{migration_sql_sha256:'old-migration'},{expected_clauses:{}},{rejections:Array.from({length:22},()=>({code:'ER_CHECK_CONSTRAINT_VIOLATED'}))},{rejections:Array.from({length:23},()=>({code:'NETWORK_ERROR'}))}])('rejects insufficient/stale rehearsal %j',patch=>expect(()=>acceptedLicensedClauses({...rehearsal(),...patch})).toThrow());
  it('replaces the changed named publish CHECK using actual MySQL text and exact desired canonical text',()=>{
    const expected={...PUBLICATION_CONSTRAINTS,chk_recitations_publish_gate_v1:'((`a` = 1) or (`b` = 1))'};
    const actual={...expected,chk_recitations_publish_gate_v1:'((`a` = 1) and (`b` = 1))'};
    const sql=licensedPublicationConstraintSql(actual,expected);
    expect(sql).toHaveLength(1);expect(sql[0]).toContain('DROP CHECK chk_recitations_publish_gate_v1');expect(sql[0]).not.toContain('DROP CHECK chk_recitations_offset_gate_v1');
    expect(licensedPublicationConstraintSql(expected,expected)).toEqual([]);
    const tokenExpected={...expected,chk_recitations_publish_gate_v1:'a b'},tokenActual={...expected,chk_recitations_publish_gate_v1:'ab'};
    expect(licensedPublicationConstraintSql(tokenActual,tokenExpected)[0]).toContain('DROP CHECK chk_recitations_publish_gate_v1');
  });
  it('does not equate regrouped expressions, literal case or changed token boundaries',()=>{
    expect(exactCheckText('a OR (b AND c)')).not.toBe(exactCheckText('(a OR b) AND c'));
    expect(exactCheckText("actor='ActorCase'")).not.toBe(exactCheckText("actor='actorcase'"));
    expect(exactCheckText('a b')).not.toBe(exactCheckText('ab'));expect(exactCheckText(' a  OR (b\nAND c) ')).toBe(exactCheckText('a OR(b AND c)'));
    const escaped="name = _utf8mb4\\'ExactCase\\'";expect(exactCheckText(escaped)).toBe(escaped);
  });
  it('atomically replaces named or auto-named legacy slice only with exact rehearsed canonical evidence',()=>{
    for(const name of ['chk_catalog_slice','recitations_chk_3']){
      const actual={...PUBLICATION_CONSTRAINTS,[name]:'exact old slice canonical',recitations_chk_9:'unrelated check'};
      const [sql]=licensedPublicationConstraintSql(actual,{...PUBLICATION_CONSTRAINTS},['exact old slice canonical']);
      expect(sql).toContain('DROP CHECK '+name);expect(sql).not.toContain('DROP CHECK recitations_chk_9');
      // Even when the new slice is already present, replace the old constraint in the same ALTER.
      expect(sql).not.toContain('DROP CHECK chk_recitations_offset_gate_v1');
      const initial={chk_recitations_offset_gate_v1:PUBLICATION_CONSTRAINTS.chk_recitations_offset_gate_v1,chk_recitations_publish_gate_v1:PUBLICATION_CONSTRAINTS.chk_recitations_publish_gate_v1,[name]:'exact old slice canonical'};
      const [replacement]=licensedPublicationConstraintSql(initial,{...PUBLICATION_CONSTRAINTS},['exact old slice canonical']);expect(replacement).toContain('DROP CHECK '+name);expect(replacement).toContain('ADD CONSTRAINT chk_recitations_slice_gate_v1');expect(replacement.match(/ALTER TABLE/gu)).toHaveLength(1);
    }
    expect(()=>licensedPublicationConstraintSql({...PUBLICATION_CONSTRAINTS,chk_catalog_slice:'unexpected expression'},PUBLICATION_CONSTRAINTS,['exact old slice canonical'])).toThrow('CANONICAL_EVIDENCE');
    expect(()=>assertExpectedCheckClauses({...PUBLICATION_CONSTRAINTS,recitations_chk_3:'exact old slice canonical'},PUBLICATION_CONSTRAINTS,['exact old slice canonical'])).toThrow('LEGACY_SLICE_STILL_PRESENT');
  });
  it('readback detects expression mismatch despite matching names and detects legacy CHECKs',()=>{
    expect(()=>assertExpectedCheckClauses({...PUBLICATION_CONSTRAINTS},PUBLICATION_CONSTRAINTS)).not.toThrow();
    expect(()=>assertExpectedCheckClauses({...PUBLICATION_CONSTRAINTS,chk_recitations_publish_gate_v1:'true'},PUBLICATION_CONSTRAINTS)).toThrow('CHECK_READBACK_CHANGED');
    expect(()=>assertExpectedCheckClauses({...PUBLICATION_CONSTRAINTS,chk_catalog_publish:'true'},PUBLICATION_CONSTRAINTS)).toThrow('LEGACY_CHECK');
  });
  it.each([now+1,now-86400000,NaN])('rejects future, old or missing verification timestamp %s',time=>expect(()=>assertFreshPublicationBackup({...backup(),checked_at:Number.isFinite(time)?new Date(time).toISOString():'missing'},now)).toThrow());
  it('checks every restored table and checksum, including nonprotected tables',()=>{
    expect(()=>assertFreshPublicationBackup(backup(),now)).not.toThrow();expect(()=>assertPublicationInventory(inventory(),inventory(),backup())).not.toThrow();
    const changed=backup();changed.checksums.arbitrary_table='200';expect(()=>assertPublicationInventory(inventory(),inventory(),changed)).toThrow('CHECKSUMS_CHANGED');
    const missing=backup();delete missing.row_counts.arbitrary_table;expect(()=>assertPublicationInventory(inventory(),inventory(),missing)).toThrow('TABLE_SET_CHANGED');
    const extra=backup();extra.row_counts.deleted_table=0;expect(()=>assertPublicationInventory(inventory(),inventory(),extra)).toThrow('TABLE_SET_CHANGED');
    expect(()=>assertPublicationInventory(inventory(),inventory(),{...backup(),restored_tables:1})).toThrow('TABLE_COUNT_CHANGED');
  });
  it('rejects a protected checksum that is missing or changed from baseline',()=>{
    const baseline=inventory();baseline.checksums.users=null;expect(()=>assertPublicationInventory(inventory(),baseline,backup())).toThrow('UNAVAILABLE');
    baseline.checksums.users='101';expect(()=>assertPublicationInventory(inventory(),baseline,backup())).toThrow('PROTECTED_CHECKSUM_STOP');
  });
  it('permits only recitations CHECK DDL to change and rejects any other changed schema',()=>{
    const before={users:'sha1',recitations:'sha2'};expect(()=>assertPublicationDdlUnchanged(before,{...before,recitations:'sha3'})).not.toThrow();
    expect(()=>assertPublicationDdlUnchanged(before,{...before,users:'sha3'})).toThrow('UNEXPECTED_DDL');expect(()=>assertPublicationDdlUnchanged(before,{...before,extra:'sha'})).toThrow('TABLE_SET');
  });
});
describe('licensed metadata SQL boundaries (unit mocks only)',()=>{
  const id='recitation-1',plan={decisions:[{id,metadata_change_planned:true}],mutations:[{id,action:'recitation.technical_publication',table:'recitation'}]};
  const sql=(set:string)=>`UPDATE recitations SET ${set} WHERE id=${d4Literal(id)};`;
  const snapshot=d4Literal(JSON.stringify({actor:'scoped-licensed-verifier-v1',text:"commas, WHERE aren't SQL"}));
  it('allows only scoped cache/audio metadata with the matching decision and audit record',()=>expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot},audio_mode=${d4Literal('surah_slice')},timing_quality=${d4Literal('verified')}`),plan)).not.toThrow());
  it('rejects human approvals and global offset writes even in an audited scoped plan',()=>{
    for(const field of ['is_public','voice_identity_status','offset_verified','verification_method','verification_details'])expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot},${field}=1`),plan)).toThrow('COLUMN_NOT_APPROVED');
  });
  it('requires a matching single recitation, audit action and decision',()=>{
    expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot}`),{})).toThrow('DECISION');
    expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot}`),{...plan,mutations:[]})).toThrow('AUDIT');
    expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot}`).replace(/ WHERE.+/u,' WHERE 1=1;'),plan)).toThrow('SINGLE_RECITATION');
    expect(()=>assertScopedPublicationMetadata(sql(`licensed_publication_details=${snapshot}`),{...plan,decisions:[{id:'other',metadata_change_planned:true}]})).toThrow('DECISION');
  });
  it('keeps the separate existing offset metadata plan valid without a licensed cache',()=>expect(()=>assertScopedPublicationMetadata(sql("offset_verified=1,verification_method='v1',timing_quality='verified'"),{})).not.toThrow());
});
