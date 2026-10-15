import { readFileSync } from 'node:fs';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { availabilitySnapshotSchema } from '../../../shared/recordingAvailability';
import { canonicalJson, hashBytes } from '../../utils/canonicalIntegrity';
export { canonicalJson, hashBytes } from '../../utils/canonicalIntegrity';

export const catalogTables = ['quran_data_sources', 'mushaf_profiles', 'reciter_catalog', 'reciter_recordings', 'recitation_coverage'] as const;
const protectedTables = ['users', 'user_roles', 'render_jobs', 'saved_videos', 'alignment_documents', 'system_settings'];
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().min(1).max(200).refine(v => v.trim() === v);
const identitySchema = z.object({ environment: z.enum(['local', 'staging', 'production']), host: label,
  port: z.number().int().positive(), serverUuid: label, schema: label, version: label }).strict();
export type TargetIdentity = z.infer<typeof identitySchema>;
const backupSchema = z.object({ source: identitySchema, sha256: sha, capturedAt: z.number().int().nonnegative(),
  baselineSha256: sha }).strict();
const restorationSchema = z.object({ backup: backupSchema, restored: identitySchema,
  restoredAt: z.number().int().nonnegative(), verificationEvidenceSha256: sha,
  verifiedBaselineSha256: sha }).strict();
export type RestorationReceipt = z.infer<typeof restorationSchema>;
const shapesSchema = z.record(z.string(), z.string().min(1));
const settingsSchema = z.object({ sqlMode: z.string(), foreignKeyChecks: z.literal(1) }).strict();
type SessionSettings = { sqlMode: string; foreignKeyChecks: number };
const safeSettings = (s: Partial<SessionSettings>) => s.foreignKeyChecks === 1
  && typeof s.sqlMode === 'string'
  && s.sqlMode.split(',').some(mode => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode.trim()));
const rehearsalSchema = restorationSchema.extend({ migrationSha256: sha, completedAt: z.number().int().nonnegative(),
  shapes: shapesSchema, shapesSha256: sha, sessionSettings: settingsSchema }).strict();
export type RehearsalReceipt = z.infer<typeof rehearsalSchema>;
export const migrationSql = readFileSync(new URL('../../../database/migrations/001-enterprise-catalog.sql', import.meta.url), 'utf8');
export const migrationSha256 = hashBytes(migrationSql);
const statements = migrationSql.replace(/^\s*--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
const circularName = 'fk_catalog_current_coverage';

export function validatedSnapshot(input: unknown) {
  const snapshot = availabilitySnapshotSchema.parse(input);
  const json = canonicalJson(snapshot);
  return { snapshot, json, sha256: hashBytes(json) };
}
const digest = (value: unknown) => hashBytes(canonicalJson(value));
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const quote = (name: string) => `\`${name.replace(/`/g, '``')}\``;
type Shapes = Record<string, string>;
async function rows(connection: Connection, sql: string) {
  const [result] = await connection.query<RowDataPacket[]>(sql);
  return result;
}
export async function inspectIdentity(connection: Connection, environment: TargetIdentity['environment']): Promise<TargetIdentity> {
  const [row] = await rows(connection, 'SELECT DATABASE() AS schemaName, @@hostname AS host, @@port AS port, @@server_uuid AS serverUuid, @@version AS version');
  return identitySchema.parse({ environment, host: row.host, port: Number(row.port), serverUuid: row.serverUuid,
    schema: row.schemaName, version: row.version });
}
/** SHOW CREATE includes columns/defaults/collations/indexes/FKs and enforced checks. Never infer compatibility from table existence. */
export function normalizeSchemaShape(shape: string): string {
  // Only a column's explicit charset implied by its exact named collation is redundant.
  // Quoted ENUM/SET members are tokens, so attribute-like text inside literals stays intact.
  return shape.replace(/^([ \t]*`(?:``|[^`])+` (?:varchar|char|tinytext|text|mediumtext|longtext|enum|set)(?:\((?:[^'()\\\r\n]|\\.|'(?:[^'\\]|\\.|'')*')*\))?) CHARACTER SET ([a-z0-9_]+)( COLLATE \2_[a-z0-9_]+)(?= |,|$)/gm, '$1$3')
    .replace(/^(\) ENGINE=[^\r\n]*?) AUTO_INCREMENT=\d+(?= |$)/gm, '$1');
}
export async function inspectShapes(connection: Connection, rawShapes?: Shapes): Promise<Shapes> {
  const tables = await rows(connection, 'SHOW FULL TABLES');
  const result: Shapes = {};
  for (const row of tables) {
    const name = String(Object.values(row)[0]);
    const [definition] = await rows(connection, `SHOW CREATE TABLE ${quote(name)}`);
    const raw = String(Object.values(definition)[1]);
    if (rawShapes) rawShapes[name] = raw;
    result[name] = normalizeSchemaShape(raw);
  }
  return result;
}
const baseline = (shapes: Shapes) => Object.fromEntries(Object.entries(shapes).filter(([name]) => !catalogTables.includes(name as typeof catalogTables[number])));
const catalog = (shapes: Shapes) => Object.fromEntries(Object.entries(shapes).filter(([name]) => catalogTables.includes(name as typeof catalogTables[number])));
function withoutCircular(shape: string): string {
  return shape.split('\n').filter(line => !line.includes(`CONSTRAINT \`${circularName}\``)).join('\n').replace(/,\n\)/g, '\n)');
}
function validateRestore(input: unknown, now: number): RestorationReceipt {
  const receipt = restorationSchema.parse(input);
  if (!/^ayahx_rehearsal_[a-zA-Z0-9_]+$/.test(receipt.restored.schema)
    || receipt.restored.environment !== 'local'
    || receipt.restored.version !== receipt.backup.source.version
    || receipt.restored.schema === receipt.backup.source.schema
    || receipt.backup.capturedAt > receipt.restoredAt || receipt.restoredAt > now
    || now - receipt.backup.capturedAt > 24 * 60 * 60 * 1000
    || receipt.verifiedBaselineSha256 !== receipt.backup.baselineSha256) throw new Error('RESTORATION_RECEIPT_INVALID');
  return receipt;
}
export type MigrationOptions = { target: TargetIdentity; mode?: 'dry-run' | 'rehearse' | 'apply';
  restoration?: unknown; rehearsal?: unknown; now?: number };

/** No app pool import, seeds, approval/publishing mutation, implicit apply or fake DDL rollback. */
export async function runEnterpriseCatalogMigration(connection: Connection, options: MigrationOptions) {
  const mode = options.mode ?? 'dry-run';
  if (!['dry-run', 'rehearse', 'apply'].includes(mode)) throw new Error('INVALID_MODE');
  const now = options.now ?? Date.now();
  const target = identitySchema.parse(options.target);
  const actual = await inspectIdentity(connection, target.environment);
  if (!equal(actual, target)) throw new Error('TARGET_IDENTITY_MISMATCH');
  const [session] = await rows(connection, 'SELECT @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks');
  const sessionSettings: SessionSettings = { sqlMode: String(session.sqlMode), foreignKeyChecks: Number(session.foreignKeyChecks) };
  if (mode !== 'dry-run' && !safeSettings(sessionSettings)) throw new Error('UNSAFE_SESSION_SETTINGS');
  const version = /^(\d+)\.(\d+)\.(\d+)/.exec(actual.version)?.slice(1).map(Number);
  if (!version || /mariadb/i.test(actual.version) || !(version[0] > 8 || (version[0] === 8
    && (version[1] > 0 || version[2] >= 16)))) throw new Error('MYSQL_ENFORCED_CHECKS_REQUIRED');
  // Session lock also spans MySQL's implicit DDL commits. It is not a transaction.
  const lock = `ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`;
  if (mode !== 'dry-run') {
    const [row] = await rows(connection, `SELECT GET_LOCK('${lock}', 0) AS acquired`);
    if (Number(row.acquired) !== 1) throw new Error('MIGRATION_LOCK_UNAVAILABLE');
  }
  try {
    const beforeRaw: Shapes = {};
    const before = await inspectShapes(connection, beforeRaw);
    if (protectedTables.some(name => !before[name])) throw new Error('PROTECTED_BASELINE_INCOMPLETE');
    const baselineSha256 = digest(baseline(before));
    let expected: Shapes | undefined;
    let restoration: RestorationReceipt | undefined;
    if (options.rehearsal !== undefined) {
      const receipt = rehearsalSchema.parse(options.rehearsal);
      restoration = validateRestore(restorationSchema.parse({ backup: receipt.backup, restored: receipt.restored,
        restoredAt: receipt.restoredAt, verificationEvidenceSha256: receipt.verificationEvidenceSha256,
        verifiedBaselineSha256: receipt.verifiedBaselineSha256 }), now);
      if (!equal(receipt.backup.source, target) || receipt.migrationSha256 !== migrationSha256
        || !safeSettings(receipt.sessionSettings) || !equal(receipt.sessionSettings, sessionSettings)
        || receipt.completedAt < receipt.restoredAt || receipt.completedAt > now
        || receipt.shapesSha256 !== digest(receipt.shapes)
        || !equal(Object.keys(receipt.shapes).sort(), [...catalogTables].sort())) throw new Error('REHEARSAL_RECEIPT_MISMATCH');
      expected = receipt.shapes;
    }
    if (mode === 'rehearse') {
      // No receipt exists until first rehearsal completes: interrupted rehearsal requires a fresh restore and updated restoration receipt.
      restoration = validateRestore(options.restoration, now);
      if (!equal(restoration.restored, target) || Object.keys(catalog(before)).length) throw new Error('FRESH_RESTORED_REHEARSAL_REQUIRED');
    }
    if (mode === 'apply' && !expected) throw new Error('REHEARSAL_RECEIPT_REQUIRED');
    if (restoration && baselineSha256 !== restoration.backup.baselineSha256) throw new Error('BACKUP_BASELINE_MISMATCH');
    for (const [table, shape] of Object.entries(catalog(before))) {
      if (!expected || (shape !== expected[table] && !(table === 'reciter_recordings'
        && !shape.includes(`CONSTRAINT \`${circularName}\``) && shape === withoutCircular(expected[table]))))
        throw new Error(`CATALOG_SCHEMA_MISMATCH:${table}`);
    }
    const pending = statements.filter((_, index) => index < catalogTables.length
      ? !before[catalogTables[index]] : !before.reciter_recordings?.includes(`CONSTRAINT \`${circularName}\``));
    if (mode === 'dry-run') return { mode, migrationSha256, target, baselineSha256, before, beforeRaw, pending, sessionSettings, sessionSafe: safeSettings(sessionSettings) };
    // Each successful statement commits independently. On failure preserve tables for inspected resume.
    for (const sql of pending) await connection.query(sql);
    const afterRaw: Shapes = {};
    const after = await inspectShapes(connection, afterRaw);
    if (digest(baseline(after)) !== baselineSha256) throw new Error('PROTECTED_SCHEMA_CHANGED');
    const shapes = catalog(after);
    if (expected && !equal(shapes, expected)) throw new Error('POST_MIGRATION_SCHEMA_MISMATCH');
    if (mode === 'rehearse') return { mode, migrationSha256, target, baselineSha256, before, after, beforeRaw, afterRaw,
      receipt: { ...restoration!, migrationSha256, completedAt: Date.now(), shapes, shapesSha256: digest(shapes),
        sessionSettings: settingsSchema.parse(sessionSettings) } satisfies RehearsalReceipt };
    return { mode, migrationSha256, target, baselineSha256, before, after, beforeRaw, afterRaw };
  } finally {
    if (mode !== 'dry-run') await connection.query(`SELECT RELEASE_LOCK('${lock}')`);
  }
}
