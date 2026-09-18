import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { closePool } from '../db';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function ensureColumn(
  connection: mysql.Connection,
  database: string,
  table: string,
  column: string,
  definition: string,
) {
  const [rows] = await connection.query<any[]>(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [database, table, column],
  );
  if (rows.length === 0) {
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added ${table}.${column}`);
  }
}

async function applySchemaUpgrades(connection: mysql.Connection, database: string) {
  // CREATE TABLE IF NOT EXISTS cannot add columns to an existing installation.
  // Keep the checkout record compatible with both a fresh and an upgraded DB.
  await ensureColumn(connection, database, 'payment_requests', 'currency', "CHAR(3) NOT NULL DEFAULT 'EGP' AFTER amount");
  await ensureColumn(connection, database, 'payment_requests', 'transfer_reference', 'VARCHAR(100) DEFAULT NULL AFTER phone_number');
}

async function setupDatabase() {
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'quran_reels';

  console.log(`Connecting to MySQL at ${host}:${port} as ${user}...`);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true,
  });

  try {
    console.log(`Ensuring database '${database}' exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    await connection.query(`USE \`${database}\`;`);

    const schemaPath = path.resolve(process.cwd(), 'database/schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log(`Applying schema from ${schemaPath}...`);
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await connection.query(schemaSql);
      console.log('Schema applied successfully!');
      await applySchemaUpgrades(connection, database);
    } else {
      console.error(`Schema file not found at ${schemaPath}`);
    }

    const { applyPerformanceIndexes } = await import('./optimizeIndexes');
    const indexReport = await applyPerformanceIndexes();
    console.log(`Performance indexes verified (${indexReport.existing.length} verified, ${indexReport.created.length} created).`);
  } catch (err) {
    console.error('Database setup failed:', err);
    process.exit(1);
  } finally {
    await connection.end();
    // optimizeIndexes uses the shared application pool. Close it as well so
    // the one-shot Railway pre-deploy command can terminate cleanly instead
    // of waiting for the platform timeout with an open MySQL socket.
    await closePool().catch(() => {});
  }
}

setupDatabase();
