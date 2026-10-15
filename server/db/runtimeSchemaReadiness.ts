import { runtimeSchemaColumns } from './runtimeSchemaContract';

export type RuntimeSchemaColumn = { tableName: string; columnName: string };
const inspectionSql = 'SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()';
/** Presence preflight only; migration receipts validate full shapes, constraints and triggers. */
export function createRuntimeSchemaCheck(read: (sql: string) => Promise<RuntimeSchemaColumn[]>, clock = Date.now) {
  let checkedAt: number | null = null;
  let pending: Promise<void> | null = null;
  return async function assertRuntimeSchemaReady(): Promise<void> {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('RUNTIME_SCHEMA_CLOCK_INVALID');
    if (checkedAt !== null && now >= checkedAt && now - checkedAt < 10_000) return;
    if (pending) return pending;
    pending = (async () => {
      const columns = await read(inspectionSql);
      const present = new Map<string, Set<string>>();
      for (const row of columns) {
        if (typeof row.tableName !== 'string' || typeof row.columnName !== 'string') throw new Error('RUNTIME_SCHEMA_INCOMPLETE');
        if (!present.has(row.tableName)) present.set(row.tableName, new Set());
        present.get(row.tableName)!.add(row.columnName);
      }
      for (const [table, expected] of Object.entries(runtimeSchemaColumns)) {
        if (expected.some(column => !present.get(table)?.has(column))) throw new Error('RUNTIME_SCHEMA_INCOMPLETE');
      }
      checkedAt = now;
    })();
    try { await pending; } finally { pending = null; }
  };
}
