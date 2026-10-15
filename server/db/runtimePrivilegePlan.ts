import { z } from 'zod';
import { runtimeSchemaColumns } from './runtimeSchemaContract';

export type RuntimeDatabaseService = 'api' | 'skia' | 'control';
export type RuntimePrivilege = Readonly<{ privilege: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'; columns?: readonly string[] }>;
export type RuntimeGrantStatement = Readonly<{ schema: string; table: string; service: RuntimeDatabaseService; scope: 'table';
  classification: 'legacy_compatibility' | 'inactive_catalog' | 'authority'; access: readonly RuntimePrivilege[];
  sql: string; params: readonly [string, '%'] }>;
export type RuntimePrivilegePlan = Readonly<{ schema: string; user: string; accountHost: '%'; service: RuntimeDatabaseService;
  scope: 'explicit_table'; compatibility: 'legacy_24_table_dml_upper_bound'; statements: readonly RuntimeGrantStatement[] }>;
const systemSchemas = new Set(['mysql', 'sys', 'information_schema', 'performance_schema']);
export const runtimeDatabaseServiceSchema = z.enum(['api', 'skia', 'control']);
export const runtimePrivilegeInputSchema = z.object({ schema: z.string().regex(/^[A-Za-z0-9_]{1,64}$/).refine(value => !systemSchemas.has(value.toLowerCase())),
  user: z.string().regex(/^[A-Za-z0-9_]{1,32}$/), service: runtimeDatabaseServiceSchema }).strict();
export type RuntimePrivilegeInput = z.infer<typeof runtimePrivilegeInputSchema>;
const legacyTables = Object.freeze(['achievements', 'alignment_documents', 'alignment_review_events', 'daily_cloud_render_usage',
  'daily_render_engine_usage', 'daily_video_usage', 'favorite_performers', 'favorite_reciters', 'favorite_surahs', 'notifications',
  'payment_requests', 'profiles', 'render_engine_capacity', 'render_job_audit', 'render_jobs', 'saved_videos', 'subscriptions',
  'system_settings', 'user_achievements', 'user_follows', 'user_roles', 'users', 'video_comments', 'video_likes']);
const inactiveTables = Object.freeze(['quran_data_sources', 'mushaf_profiles', 'reciter_catalog', 'reciter_recordings', 'recitation_coverage']);
const authorityTables = Object.freeze(['catalog_role_grants', 'catalog_audit_events']);
const select: RuntimePrivilege = Object.freeze({ privilege: 'SELECT' });
const insert: RuntimePrivilege = Object.freeze({ privilege: 'INSERT' });
const readOnly = Object.freeze([select]);
const legacyDml = Object.freeze([select, insert, Object.freeze({ privilege: 'UPDATE' as const }), Object.freeze({ privilege: 'DELETE' as const })]);
const auditAppend = Object.freeze([select, insert]);
const grantRevocation = Object.freeze([select, insert, Object.freeze({ privilege: 'UPDATE' as const,
  columns: Object.freeze(['revoked_at_epoch_ms', 'revocation_audit_event_id']) })]);
const quote = (value: string) => '`' + value + '`'; // Only validated/fixed identifiers reach here.

/**
 * Pure MySQL 9.7 statement plan. Execute with mysql2.query(sql, params), not identifier interpolation or server PREPARE.
 * GRANT unions with existing privileges: a separate privileged operator must verify a NEW principal before applying.
 * Legacy DML is a compatibility upper bound, not a claim of per-service least privilege or deploy readiness.
 */
export function buildRuntimePrivilegePlan(input: unknown): RuntimePrivilegePlan {
  const { schema, user, service } = runtimePrivilegeInputSchema.parse(input);
  const expected = [...legacyTables, ...inactiveTables, ...authorityTables].sort();
  const actual = Object.keys(runtimeSchemaColumns).sort();
  if (expected.length !== 31 || new Set(expected).size !== 31 || JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error('RUNTIME_PRIVILEGE_SCHEMA_CONTRACT_CHANGED');
  if (grantRevocation[2].columns!.some(column => !runtimeSchemaColumns.catalog_role_grants.includes(column)))
    throw new Error('RUNTIME_PRIVILEGE_REVOCATION_COLUMNS_CHANGED');
  const statements = actual.map((table): RuntimeGrantStatement => {
    const classification = legacyTables.includes(table) ? 'legacy_compatibility' : inactiveTables.includes(table) ? 'inactive_catalog' : 'authority';
    const access: readonly RuntimePrivilege[] = classification === 'legacy_compatibility' ? legacyDml : classification === 'inactive_catalog' || service !== 'api'
      ? readOnly : table === 'catalog_role_grants' ? grantRevocation : auditAppend;
    const privileges = access.map(entry => entry.privilege + (entry.columns ? ' (' + entry.columns.map(quote).join(', ') + ')' : '')).join(', ');
    return Object.freeze({ schema, table, service, scope: 'table', classification, access,
      sql: `GRANT ${privileges} ON ${quote(schema)}.${quote(table)} TO ?@?`, params: Object.freeze([user, '%'] as const) });
  });
  return Object.freeze({ schema, user, accountHost: '%', service, scope: 'explicit_table',
    compatibility: 'legacy_24_table_dml_upper_bound', statements: Object.freeze(statements) });
}
