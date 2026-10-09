import type { Connection, RowDataPacket } from 'mysql2/promise';
import { QURAN_CATALOG_TABLES } from '../db/migrations/002_addQuranCatalogTables';
import type { CatalogDataset, CatalogRow } from './qudCatalogImport';

const jsonColumns = new Set(['host_allowlist', 'verification_details', 'catalog_raw', 'audit_json', 'missing_verses']);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function verifyCatalogRows(db: Pick<Connection, 'query'>, dataset: CatalogDataset): Promise<Record<string, number>> {
  const tables: Record<string, CatalogRow[]> = { reciters: dataset.reciters, audio_providers: dataset.providers, recitations: dataset.recitations, recitation_chapters: dataset.chapters };
  const counts: Record<string, number> = {};
  for (const [table, expected] of Object.entries(tables)) {
    const [rows] = await db.query<RowDataPacket[]>(`SELECT * FROM ${table}`);
    if (rows.length !== expected.length) throw new Error(`STORED_CATALOG_COUNT_MISMATCH:${table}`);
    counts[table] = rows.length;
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const input of expected) {
      const stored = byId.get(input.id);
      if (!stored) throw new Error(`STORED_CATALOG_ID_MISSING:${table}`);
      for (const [column, value] of Object.entries(input)) {
        let actual = stored[column];
        let reference: unknown = value;
        if (jsonColumns.has(column)) {
          actual = typeof actual === 'string' ? JSON.parse(actual) : actual;
          reference = typeof value === 'string' ? JSON.parse(value) : value;
        } else if (typeof value === 'boolean') actual = Boolean(actual);
        if (canonical(actual) !== canonical(reference)) throw new Error(`STORED_CATALOG_VALUE_MISMATCH:${table}.${column}`);
      }
      if (table === 'recitation_chapters' && (stored.timing_complete !== null || Number(stored.is_complete) !== 0)) throw new Error('D2_TIMING_OR_COMPLETENESS_INVALID');
    }
  }
  const [riwayat] = await db.query<RowDataPacket[]>('SELECT * FROM riwayat');
  for (const expected of dataset.riwayat) {
    const actual = riwayat.find((row) => row.code === expected.code);
    if (!actual || Object.entries(expected).some(([column, value]) => canonical(column === 'is_active' ? Boolean(actual[column]) : actual[column]) !== canonical(value))) throw new Error('IMPORTED_RIWAYAH_METADATA_MISMATCH');
  }
  return counts;
}

export async function verifyCatalogSchema(db: Pick<Connection, 'query'>): Promise<{ tables: number; text_columns: number; internal_foreign_keys: number }> {
  const names = QURAN_CATALOG_TABLES.map(() => '?').join(',');
  const [tables] = await db.query<RowDataPacket[]>(`SELECT TABLE_NAME,TABLE_COLLATION,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names})`, [...QURAN_CATALOG_TABLES]);
  if (tables.length !== QURAN_CATALOG_TABLES.length || tables.some((row) => row.TABLE_COLLATION !== 'utf8mb4_unicode_ci' || row.ENGINE !== 'InnoDB')) throw new Error('D2_TABLE_SCHEMA_POLICY_MISMATCH');
  const [columns] = await db.query<RowDataPacket[]>(`SELECT COLUMN_NAME,COLLATION_NAME,CHARACTER_SET_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names}) AND CHARACTER_SET_NAME IS NOT NULL`, [...QURAN_CATALOG_TABLES]);
  if (columns.some((row) => row.COLLATION_NAME !== 'utf8mb4_unicode_ci' || row.CHARACTER_SET_NAME !== 'utf8mb4')) throw new Error('D2_COLUMN_COLLATION_MISMATCH');
  const [keys] = await db.query<RowDataPacket[]>(`SELECT REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names}) AND REFERENCED_TABLE_NAME IS NOT NULL`, [...QURAN_CATALOG_TABLES]);
  const [database] = await db.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (keys.length !== 3 || keys.some((row) => row.REFERENCED_TABLE_SCHEMA !== database[0].name || !(QURAN_CATALOG_TABLES as readonly string[]).includes(row.REFERENCED_TABLE_NAME))) throw new Error('D2_FOREIGN_KEY_POLICY_MISMATCH');
  return { tables: tables.length, text_columns: columns.length, internal_foreign_keys: keys.length };
}
