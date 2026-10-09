import type { Connection, RowDataPacket } from 'mysql2/promise';
import { QURAN_TEXT_TABLES } from '../db/migrations/001_addQuranTextTables';

/** Read-only policy check of the schema actually created by MySQL. */
export async function verifyQuranTextSchemaCollations(connection: Pick<Connection, 'query'>): Promise<{
  tableCount: number; textColumnCount: number; canonicalColumns: number;
}> {
  const parameters = QURAN_TEXT_TABLES.map(() => '?').join(',');
  const [tables] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${parameters})`, [...QURAN_TEXT_TABLES],
  );
  if (tables.length !== QURAN_TEXT_TABLES.length || tables.some((row) => row.TABLE_COLLATION !== 'utf8mb4_unicode_ci')) throw new Error('D1_TABLE_COLLATION_MISMATCH');
  const [columns] = await connection.query<RowDataPacket[]>(
    `SELECT TABLE_NAME,COLUMN_NAME,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${parameters}) AND CHARACTER_SET_NAME IS NOT NULL`, [...QURAN_TEXT_TABLES],
  );
  for (const row of columns) {
    const expected = row.COLUMN_NAME === 'text_uthmani' ? 'utf8mb4_bin' : 'utf8mb4_unicode_ci';
    if (row.CHARACTER_SET_NAME !== 'utf8mb4' || row.COLLATION_NAME !== expected) throw new Error(`D1_COLUMN_COLLATION_MISMATCH:${row.TABLE_NAME}.${row.COLUMN_NAME}`);
  }
  const canonicalColumns = columns.filter((row) => row.COLUMN_NAME === 'text_uthmani').length;
  if (canonicalColumns !== 2) throw new Error('D1_CANONICAL_COLUMNS_MISSING');
  const [foreignKeys] = await connection.query<RowDataPacket[]>(
    `SELECT REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${parameters}) AND REFERENCED_TABLE_NAME IS NOT NULL`, [...QURAN_TEXT_TABLES],
  );
  const [database] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS name');
  if (foreignKeys.some((row) => row.REFERENCED_TABLE_SCHEMA !== database[0].name || !QURAN_TEXT_TABLES.includes(row.REFERENCED_TABLE_NAME))) throw new Error('D1_FOREIGN_KEY_TO_EXISTING_TABLE_FORBIDDEN');
  return { tableCount: tables.length, textColumnCount: columns.length, canonicalColumns };
}
