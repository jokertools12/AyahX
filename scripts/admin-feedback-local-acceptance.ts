/** Disposable MySQL 9.7.2 rehearsal for migration009; never contacts Railway. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { adminFeedbackMigrationSql, downAdminFeedback, upAdminFeedback } from '../server/db/migrations/009_addAdminFeedback';

const raw = process.env.ADMIN_FEEDBACK_MYSQL_URL ?? 'mysql://root@127.0.0.1:33319';
const address = new URL(raw);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname), 'LOCAL_MYSQL_REQUIRED');
const schema = `ayahx_feedback_rehearsal_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const admin = await mysql.createConnection({ uri: raw, multipleStatements: true });
try {
  const [version] = await admin.query<Array<{ version: string }>>('SELECT VERSION() version');
  assert.equal(version[0]?.version, '9.7.2', 'REAL_MYSQL_9_7_2_REQUIRED');
  await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.changeUser({ database: schema });
  const ddl = { query: async (sql: string) => { await admin.query(sql); } };
  await upAdminFeedback(ddl); await upAdminFeedback(ddl);
  const [columns] = await admin.query<Array<{ COLUMN_NAME: string; IS_NULLABLE: string; COLLATION_NAME: string | null }>>("SELECT COLUMN_NAME,IS_NULLABLE,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback' ORDER BY ORDINAL_POSITION");
  assert.equal(columns.length, 17, 'ADMIN_FEEDBACK_COLUMNS_MISSING');
  assert.equal(columns.find(column => column.COLUMN_NAME === 'actor_id')?.IS_NULLABLE, 'YES');
  assert.equal(columns.find(column => column.COLUMN_NAME === 'message')?.IS_NULLABLE, 'YES');
  assert.equal(columns.find(column => column.COLUMN_NAME === 'status')?.IS_NULLABLE, 'NO');
  assert.ok(columns.filter(column => column.COLLATION_NAME).every(column => column.COLLATION_NAME === 'utf8mb4_unicode_ci'), 'ADMIN_FEEDBACK_COLLATION_MISMATCH');
  const [foreignKeys] = await admin.query<Array<{ n: number }>>("SELECT COUNT(*) n FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback' AND REFERENCED_TABLE_NAME IS NOT NULL");
  assert.equal(Number(foreignKeys[0]?.n), 0, 'ADMIN_FEEDBACK_FOREIGN_KEY_FORBIDDEN');
  await downAdminFeedback(ddl, 'local-rehearsal'); await downAdminFeedback(ddl, 'local-rehearsal');
  const [absent] = await admin.query<Array<{ n: number }>>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback'");
  assert.equal(Number(absent[0]?.n), 0, 'ADMIN_FEEDBACK_DOWN_FAILED');
  await upAdminFeedback(ddl);
  const [reapplied] = await admin.query<Array<{ n: number }>>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='admin_feedback'");
  assert.equal(Number(reapplied[0]?.n), 1, 'ADMIN_FEEDBACK_REAPPLY_FAILED');
  console.log(JSON.stringify({ local_only: true, mysql_version: version[0]?.version, schema, sql_statements: adminFeedbackMigrationSql().length, migration: '009', up_twice: true, down_twice: true, reapply: true, foreign_keys: 0, nullable: ['actor_id', 'message'], status: 'passed' }));
} finally {
  await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch(() => undefined);
  await admin.end();
}
