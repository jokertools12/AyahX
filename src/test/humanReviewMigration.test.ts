import {describe,it,expect,vi} from 'vitest';
import {humanReviewMigrationSql,downHumanReviewsAndLicensedSources,licensedSourceColumns} from '../../server/db/migrations/005_addHumanReviewsAndLicensedSources';
describe('migration005 contract',()=>{
  it('creates only three new tables with explicit text collations and no old FKs',()=>{const sql=humanReviewMigrationSql().join('\n');expect(sql.match(/CREATE TABLE IF NOT EXISTS/gu)).toHaveLength(3);expect(sql).not.toMatch(/FOREIGN KEY/iu);expect(sql).toContain("'auto_verified'");expect(sql).toContain('utf8mb4_bin');expect(sql).toContain('uk_human_review_subject');expect(sql).toContain('uk_storage_immutable_object');});
  it('all added old-table columns are nullable',()=>{for(const columns of Object.values(licensedSourceColumns))for(const definition of Object.values(columns)){expect(definition).toContain('DEFAULT NULL');expect(definition).not.toContain('NOT NULL');}});
  it('refuses destructive down outside local rehearsal before SQL',async()=>{const db={query:vi.fn(async()=>{})};await expect(downHumanReviewsAndLicensedSources(db,'production' as 'local-rehearsal')).rejects.toThrow('DESTRUCTIVE_REHEARSAL_ONLY');expect(db.query).not.toHaveBeenCalled();});
  it('down guards enum narrowing against unreviewed data loss',async()=>{const db={query:vi.fn(async()=>{})};await downHumanReviewsAndLicensedSources(db,'local-rehearsal');expect(db.query.mock.calls[0][0]).toContain("voice_identity_status='auto_verified'");});
});
