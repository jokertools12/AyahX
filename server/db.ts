import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { config } from './config';

export const pool: Pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  multipleStatements: false,
});

export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  const [rows] = await pool.query(sql, params);
  return rows as T;
}

export async function transaction<T>(callback: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await callback(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Acquires a MySQL advisory lock for singleton control-plane work. The
 * connection must remain open for the lifetime of the lock; MySQL releases it
 * automatically if the process or connection disappears.
 */
export async function acquireMysqlAdvisoryLock(lockName: string): Promise<PoolConnection | null> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<any[]>('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (Number(rows[0]?.acquired) !== 1) {
      conn.release();
      return null;
    }
    return conn;
  } catch (error) {
    conn.release();
    throw error;
  }
}

export async function releaseMysqlAdvisoryLock(conn: PoolConnection, lockName: string): Promise<void> {
  try {
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
  } finally {
    conn.release();
  }
}

/**
 * Pings the database to verify active connection pool readiness and measure round-trip latency.
 */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message || 'Database unreachable' };
  }
}

/**
 * Gracefully terminates all active pooled MySQL connections.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
