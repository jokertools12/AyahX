import { readFileSync } from 'node:fs';
import type { Connection } from 'mysql2/promise';
import { inspectIdentity, inspectShapes } from './enterpriseCatalog';
import { hashBytes } from '../../utils/canonicalIntegrity';
import { additiveBaselineSha256, inspectAdditiveShapes, runAdditiveMigration, type AdditiveDefinition, type AdditiveOptions } from './additiveMigrationRunner';

export const authorityMigrationSql = readFileSync(new URL('../../../database/migrations/002-catalog-authority.sql', import.meta.url), 'utf8');
const tables = Object.freeze(['catalog_role_grants', 'catalog_audit_events']);
const triggers = Object.freeze(['catalog_audit_no_update', 'catalog_audit_no_delete']);
const finalForeignKeys = ['fk_catalog_grant_created_event', 'fk_catalog_grant_revoked_event'];
function beforeFinalForeignKeys(shape: string): string {
  return shape.split('\n').filter(line => !finalForeignKeys.some(name => line.includes(`CONSTRAINT \`${name}\``)))
    .join('\n').replace(/,\n\)/g, '\n)');
}
// This fixed SQL contains five single statements and no procedural BEGIN/DELIMITER blocks.
const sqlSteps = authorityMigrationSql.replace(/^\s*--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
const prefixes = ['CREATE TABLE catalog_role_grants (', 'CREATE TABLE catalog_audit_events (',
  'ALTER TABLE catalog_role_grants', 'CREATE TRIGGER catalog_audit_no_update ', 'CREATE TRIGGER catalog_audit_no_delete '];
if (sqlSteps.length !== 5 || sqlSteps.some((sql, index) => !sql.startsWith(prefixes[index]))) throw new Error('AUTHORITY_MIGRATION_DEFINITION_INVALID');
export const authorityMigrationDefinition: AdditiveDefinition = Object.freeze({ id: '002-catalog-authority', sql: authorityMigrationSql,
  tables, triggers, requiredTables: Object.freeze(['users', 'user_roles', 'render_jobs', 'saved_videos', 'alignment_documents', 'system_settings',
    'quran_data_sources', 'mushaf_profiles', 'reciter_catalog', 'reciter_recordings', 'recitation_coverage']),
  steps: Object.freeze(sqlSteps.map((sql, index) => Object.freeze({ sql,
    kind: index < 2 ? 'table' as const : index === 2 ? 'finalize_table' as const : 'trigger' as const,
    name: index < 2 ? tables[index] : index === 2 ? tables[0] : triggers[index - 3] }))),
  partialTables: Object.freeze({ catalog_role_grants: beforeFinalForeignKeys }),
});
export const authorityInspectors = Object.freeze({ identity: inspectIdentity, tables: inspectShapes });
export async function inspectEnterpriseAuthorityBaseline(connection: Connection) {
  const inspection = await inspectAdditiveShapes(connection, authorityInspectors);
  return { ...inspection, migrationId: authorityMigrationDefinition.id, migrationSha256: hashBytes(authorityMigrationSql),
    baselineSha256: additiveBaselineSha256(inspection.shapes, authorityMigrationDefinition) };
}
/** CLI-only. No app startup import, seeds or implicit execution. */
export function runEnterpriseAuthorityMigration(connection: Connection, options: AdditiveOptions) {
  return runAdditiveMigration(connection, authorityMigrationDefinition, authorityInspectors, options);
}
