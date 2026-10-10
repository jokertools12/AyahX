/** Real storage advisory checks, read-only and private-local only. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import type { RowDataPacket } from 'mysql2/promise';
const i = process.argv.indexOf('--local-db');
const database = process.argv[i + 1];
assert.ok(i > 0); assert.match(database, /^ayahx_d2_[a-z0-9_]+$/u);
Object.assign(process.env, { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '33319', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: database, STORAGE_VOLUME_BYTES: '5000000000' });
const { pool } = await import('../server/db');
const { readQuranStorageHealth } = await import('../server/services/quranStorageHealth');
try {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT VERSION() version'); assert.equal(rows[0].version, '9.7.2');
  const actual = await readQuranStorageHealth(); assert.equal(actual.source,'information_schema'); assert.equal(actual.status,'ok');
  process.env.STORAGE_VOLUME_BYTES='1'; const warning=await readQuranStorageHealth(); assert.equal(warning.status,'warning');
  delete process.env.STORAGE_VOLUME_BYTES; const missing=await readQuranStorageHealth(); assert.equal(missing.status,'unavailable');
  writeFileSync('docs/data/d3-close-storage-real-mysql.json',JSON.stringify({checked_at:new Date().toISOString(),mysql:'9.7.2',real_database:true,actual,warning,missing,passed:true},null,2)+'\n');
  console.log(JSON.stringify({real_mysql:true,passed:true,allocated_bytes:actual.allocatedTableBytes}));
} finally { await pool.end(); }
