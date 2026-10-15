import { readFileSync } from 'node:fs';
import { inspectAdditiveShapes, runAdditiveMigration, type AdditiveDefinition, type AdditiveOptions } from './additiveMigrationRunner';
import { inspectIdentity, inspectShapes } from './enterpriseCatalog';

export const sourceResolutionLedgerMigrationSql = readFileSync(new URL('../../../database/migrations/003-source-resolution-ledger.sql', import.meta.url), 'utf8');
const tables = Object.freeze(['source_resolution_requests', 'source_resolution_attempts']);
const triggers = Object.freeze([
  'source_resolution_requests_no_update', 'source_resolution_requests_no_delete',
  'source_resolution_attempts_no_update', 'source_resolution_attempts_no_delete',
]);
const requiredTables = Object.freeze([
  'achievements', 'alignment_documents', 'alignment_review_events', 'daily_cloud_render_usage', 'daily_render_engine_usage',
  'daily_video_usage', 'favorite_performers', 'favorite_reciters', 'favorite_surahs', 'notifications', 'payment_requests',
  'profiles', 'render_engine_capacity', 'render_job_audit', 'render_jobs', 'saved_videos', 'subscriptions', 'system_settings',
  'user_achievements', 'user_follows', 'user_roles', 'users', 'video_comments', 'video_likes',
  'quran_data_sources', 'mushaf_profiles', 'reciter_catalog', 'reciter_recordings', 'recitation_coverage',
  'catalog_role_grants', 'catalog_audit_events',
]);
const statements = sourceResolutionLedgerMigrationSql.replace(/^\s*--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
const expectedPrefixes = [
  'CREATE TABLE `source_resolution_requests`', 'CREATE TABLE `source_resolution_attempts`',
  'CREATE TRIGGER `source_resolution_requests_no_update`', 'CREATE TRIGGER `source_resolution_requests_no_delete`',
  'CREATE TRIGGER `source_resolution_attempts_no_update`', 'CREATE TRIGGER `source_resolution_attempts_no_delete`',
];
if (statements.length !== expectedPrefixes.length || statements.some((sql, index) => !sql.startsWith(expectedPrefixes[index]))) {
  throw new Error('SOURCE_RESOLUTION_LEDGER_MIGRATION_DEFINITION_INVALID');
}

export const sourceResolutionLedgerMigrationDefinition: AdditiveDefinition = Object.freeze({
  id: '003-source-resolution-ledger',
  sql: sourceResolutionLedgerMigrationSql,
  tables,
  triggers,
  requiredTables,
  steps: Object.freeze(statements.map((sql, index) => Object.freeze({
    sql,
    kind: index < tables.length ? 'table' as const : 'trigger' as const,
    name: index < tables.length ? tables[index] : triggers[index - tables.length],
  }))),
  partialTables: Object.freeze({}),
});

export const sourceResolutionLedgerInspectors = Object.freeze({ identity: inspectIdentity, tables: inspectShapes });
export function runSourceResolutionLedgerMigration(connection: Parameters<typeof runAdditiveMigration>[0], options: AdditiveOptions) {
  return runAdditiveMigration(connection, sourceResolutionLedgerMigrationDefinition, sourceResolutionLedgerInspectors, options);
}
export async function inspectSourceResolutionLedgerBaseline(connection: Parameters<typeof inspectAdditiveShapes>[0]) {
  return inspectAdditiveShapes(connection, sourceResolutionLedgerInspectors);
}
