import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { canonicalJson, hashBytes } from '../../utils/canonicalIntegrity';

const label = z.string().min(1).max(200).refine(value => value.trim() === value);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().safe();
export const additiveTargetSchema = z.object({ environment: z.enum(['local', 'staging', 'production']),
  host: label, port: z.number().int().positive(), serverUuid: label, schema: label, version: label }).strict();
export type AdditiveTarget = z.infer<typeof additiveTargetSchema>;
const backupSchema = z.object({ source: additiveTargetSchema, sha256: sha, capturedAt: time, baselineSha256: sha }).strict();
export const additiveRestorationSchema = z.object({ migrationId: label, migrationSha256: sha,
  backup: backupSchema, restored: additiveTargetSchema, restoredAt: time, verificationEvidenceSha256: sha,
  verifiedBaselineSha256: sha }).strict();
export type AdditiveRestorationReceipt = z.infer<typeof additiveRestorationSchema>;
// MySQL SHOW CREATE TRIGGER metadata: preserve definer/body/sql_mode/charset/collations; ignore ONLY Created.
export const triggerShapeSchema = z.object({ Trigger: label, sql_mode: z.string(), 'SQL Original Statement': z.string().min(1),
  character_set_client: label, collation_connection: label, 'Database Collation': label }).strict();
export type TriggerShape = z.infer<typeof triggerShapeSchema>;
const shapeSchema = z.object({ tables: z.record(z.string(), z.string().min(1)), triggers: z.record(z.string(), triggerShapeSchema) }).strict();
export type AdditiveShapes = z.infer<typeof shapeSchema>;
const settingsSchema = z.object({ sqlMode: z.string(), foreignKeyChecks: z.literal(1) }).strict();
export const additiveRehearsalSchema = additiveRestorationSchema.extend({ completedAt: time,
  ownShapes: shapeSchema, ownShapesSha256: sha, sessionSettings: settingsSchema }).strict();
export type AdditiveRehearsalReceipt = z.infer<typeof additiveRehearsalSchema>;
type SessionSettings = { sqlMode: string; foreignKeyChecks: number };
const safeSettings = (s: Partial<SessionSettings>) => s.foreignKeyChecks === 1 && typeof s.sqlMode === 'string'
  && s.sqlMode.split(',').some(mode => ['STRICT_TRANS_TABLES', 'STRICT_ALL_TABLES'].includes(mode.trim()));
export type AdditiveStep = Readonly<{ kind: 'table' | 'finalize_table' | 'trigger'; name: string; sql: string }>;
export type AdditiveDefinition = Readonly<{ id: string; sql: string; tables: readonly string[]; triggers: readonly string[];
  requiredTables: readonly string[]; steps: readonly AdditiveStep[];
  partialTables: Readonly<Record<string, (finalShape: string) => string>> }>;
export type AdditiveInspectors = {
  identity: (connection: Connection, environment: AdditiveTarget['environment']) => Promise<AdditiveTarget>;
  tables: (connection: Connection, raw?: Record<string, string>) => Promise<Record<string, string>>;
};
export type AdditiveOptions = { target: AdditiveTarget; mode?: 'dry-run' | 'rehearse' | 'apply';
  restoration?: unknown; rehearsal?: unknown; now?: number };
export const additiveShapeSha256 = (shape: unknown) => hashBytes(canonicalJson(shape));
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const quote = (name: string) => '`' + name.replace(/`/g, '``') + '`';
async function rows(connection: Connection, sql: string) { return (await connection.query<RowDataPacket[]>(sql))[0]; }

export async function inspectAdditiveShapes(connection: Connection, inspectors: AdditiveInspectors) {
  const rawTables: Record<string, string> = {};
  const tables = await inspectors.tables(connection, rawTables);
  const triggers: Record<string, TriggerShape> = {};
  const rawTriggers: Record<string, Record<string, unknown>> = {};
  for (const row of await rows(connection, 'SHOW TRIGGERS')) {
    const name = label.parse(row.Trigger);
    const definitions = await rows(connection, `SHOW CREATE TRIGGER ${quote(name)}`);
    if (definitions.length !== 1 || Object.prototype.hasOwnProperty.call(triggers, name)) throw new Error('TRIGGER_INSPECTION_INVALID');
    const { Created: _created, ...definition } = definitions[0];
    const shape = triggerShapeSchema.parse(definition);
    if (shape.Trigger !== name) throw new Error('TRIGGER_INSPECTION_INVALID');
    rawTriggers[name] = { ...definitions[0] };
    triggers[name] = shape;
  }
  return { shapes: { tables, triggers }, raw: { tables: rawTables, triggers: rawTriggers } };
}
export type AdditiveInspection = Awaited<ReturnType<typeof inspectAdditiveShapes>>;
export type AdditiveReport = { mode: 'dry-run' | 'rehearse' | 'apply'; migrationId: string; migrationSha256: string;
  target: AdditiveTarget; baselineSha256: string; sessionSettings: SessionSettings; sessionSafe: boolean;
  before: AdditiveInspection; pending: readonly AdditiveStep[]; after?: AdditiveInspection; receipt?: AdditiveRehearsalReceipt };
function selectShapes(shapes: AdditiveShapes, definition: AdditiveDefinition, own: boolean): AdditiveShapes {
  return { tables: Object.fromEntries(Object.entries(shapes.tables).filter(([name]) => definition.tables.includes(name) === own)),
    triggers: Object.fromEntries(Object.entries(shapes.triggers).filter(([name]) => definition.triggers.includes(name) === own)) };
}
/** Exact same protected table+trigger projection used by receipt validation and post-DDL checks. */
export function additiveBaselineSha256(shapes: AdditiveShapes, definition: AdditiveDefinition): string {
  return additiveShapeSha256(selectShapes(shapes, definition, false));
}
function validateRestoration(input: unknown, definition: AdditiveDefinition, now: number) {
  const r = additiveRestorationSchema.parse(input);
  if (r.migrationId !== definition.id || r.migrationSha256 !== hashBytes(definition.sql)
    || !/^ayahx_rehearsal_[a-zA-Z0-9_]+$/.test(r.restored.schema) || r.restored.environment !== 'local'
    || r.restored.schema === r.backup.source.schema || r.restored.version !== r.backup.source.version
    || r.backup.capturedAt > r.restoredAt || r.restoredAt > now || now - r.backup.capturedAt > 86400000
    || r.verifiedBaselineSha256 !== r.backup.baselineSha256) throw new Error('RESTORATION_RECEIPT_INVALID');
  return r;
}

/** CLI-only injected DDL runner. Each statement commits independently; this never promises transactional rollback. */
export async function runAdditiveMigration(connection: Connection, definition: AdditiveDefinition,
  inspectors: AdditiveInspectors, options: AdditiveOptions): Promise<AdditiveReport> {
  const mode = options.mode ?? 'dry-run';
  if (!['dry-run', 'rehearse', 'apply'].includes(mode)) throw new Error('INVALID_MODE');
  const now = time.parse(options.now ?? Date.now());
  const target = additiveTargetSchema.parse(options.target);
  const actual = await inspectors.identity(connection, target.environment);
  if (!equal(actual, target)) throw new Error('TARGET_IDENTITY_MISMATCH');
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(actual.version)?.slice(1).map(Number);
  if (!v || /mariadb/i.test(actual.version) || !(v[0] > 8 || v[0] === 8 && (v[1] > 0 || v[2] >= 16))) throw new Error('MYSQL_ENFORCED_CHECKS_REQUIRED');
  const [session] = await rows(connection, 'SELECT @@SESSION.sql_mode AS sqlMode, @@SESSION.foreign_key_checks AS foreignKeyChecks');
  const sessionSettings = { sqlMode: String(session.sqlMode), foreignKeyChecks: Number(session.foreignKeyChecks) };
  if (mode !== 'dry-run' && !safeSettings(sessionSettings)) throw new Error('UNSAFE_SESSION_SETTINGS');
  const lock = `ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`; // Same lock as migration 001.
  if (mode !== 'dry-run' && Number((await rows(connection, `SELECT GET_LOCK('${lock}', 0) AS acquired`))[0].acquired) !== 1)
    throw new Error('MIGRATION_LOCK_UNAVAILABLE');
  try {
    const before = await inspectAdditiveShapes(connection, inspectors);
    if (definition.requiredTables.some(name => !before.shapes.tables[name])) throw new Error('PROTECTED_BASELINE_INCOMPLETE');
    const baselineSha256 = additiveBaselineSha256(before.shapes, definition);
    const own = selectShapes(before.shapes, definition, true);
    let expected: AdditiveShapes | undefined;
    let restoration: AdditiveRestorationReceipt | undefined;
    if (options.rehearsal !== undefined) {
      const r = additiveRehearsalSchema.parse(options.rehearsal);
      const { completedAt: _time, ownShapes: _shapes, ownShapesSha256: _sha, sessionSettings: _settings, ...restored } = r;
      restoration = validateRestoration(restored, definition, now);
      if (!equal(r.backup.source, target) || r.completedAt < r.restoredAt || r.completedAt > now
        || !safeSettings(r.sessionSettings) || !equal(r.sessionSettings, sessionSettings)
        || r.ownShapesSha256 !== additiveShapeSha256(r.ownShapes)
        || !equal(Object.keys(r.ownShapes.tables).sort(), [...definition.tables].sort())
        || !equal(Object.keys(r.ownShapes.triggers).sort(), [...definition.triggers].sort())) throw new Error('REHEARSAL_RECEIPT_MISMATCH');
      expected = r.ownShapes;
    }
    if (mode === 'rehearse') {
      restoration = validateRestoration(options.restoration, definition, now);
      // A failed FIRST rehearsal has no successful receipt: use a newly restored scratch and updated restoration receipt.
      if (!equal(restoration.restored, target) || Object.keys(own.tables).length || Object.keys(own.triggers).length)
        throw new Error('FRESH_RESTORED_REHEARSAL_REQUIRED');
    }
    if (mode === 'apply' && !expected) throw new Error('REHEARSAL_RECEIPT_REQUIRED');
    if (restoration && baselineSha256 !== restoration.backup.baselineSha256) throw new Error('BACKUP_BASELINE_MISMATCH');
    for (const [name, shape] of Object.entries(own.tables)) {
      if (!expected || shape !== expected.tables[name] && shape !== definition.partialTables[name]?.(expected.tables[name]))
        throw new Error(`ADDITIVE_TABLE_MISMATCH:${name}`);
    }
    for (const [name, shape] of Object.entries(own.triggers))
      if (!expected || !equal(shape, expected.triggers[name])) throw new Error(`ADDITIVE_TRIGGER_MISMATCH:${name}`);
    const completed = definition.steps.map(step => step.kind === 'table' ? Boolean(own.tables[step.name])
      : step.kind === 'trigger' ? Boolean(own.triggers[step.name]) : Boolean(expected && own.tables[step.name] === expected.tables[step.name]));
    if (completed.some((done, index) => done && completed.slice(0, index).includes(false))) throw new Error('NONPREFIX_PARTIAL_MIGRATION');
    const pending = definition.steps.filter((_, index) => !completed[index]);
    const report = { mode, migrationId: definition.id, migrationSha256: hashBytes(definition.sql), target,
      baselineSha256, sessionSettings, sessionSafe: safeSettings(sessionSettings), before, pending };
    if (mode === 'dry-run') return report;
    for (const step of pending) await connection.query(step.sql);
    const after = await inspectAdditiveShapes(connection, inspectors);
    if (additiveBaselineSha256(after.shapes, definition) !== baselineSha256) throw new Error('PROTECTED_SCHEMA_CHANGED');
    const ownShapes = selectShapes(after.shapes, definition, true);
    if (!equal(Object.keys(ownShapes.tables).sort(), [...definition.tables].sort())
      || !equal(Object.keys(ownShapes.triggers).sort(), [...definition.triggers].sort())
      || expected && !equal(ownShapes, expected)) throw new Error('POST_MIGRATION_SCHEMA_MISMATCH');
    if (mode === 'rehearse') return { ...report, after, receipt: { ...restoration!, completedAt: Date.now(), ownShapes,
      ownShapesSha256: additiveShapeSha256(ownShapes), sessionSettings: settingsSchema.parse(sessionSettings) } satisfies AdditiveRehearsalReceipt };
    return { ...report, after };
  } finally { if (mode !== 'dry-run') await connection.query(`SELECT RELEASE_LOCK('${lock}')`); }
}
