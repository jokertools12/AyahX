/** Remove only the disposable load-test data created by staging-render-load.ts. */
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

const CONFIRMATION = 'DELETE_STAGING_RENDER_LOAD_DATA';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function configuredRunIds(): string[] {
  return (process.env.STAGING_LOAD_RUN_IDS || '')
    .split(',')
    .map((runId) => runId.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  if (process.env.STAGING_LOAD_CLEANUP_CONFIRM !== CONFIRMATION) {
    throw new Error(`Refusing cleanup. Set STAGING_LOAD_CLEANUP_CONFIRM=${CONFIRMATION}.`);
  }
  const connection = await mysql.createConnection({
    host: required('STAGING_LOAD_DB_HOST'),
    port: Number(process.env.STAGING_LOAD_DB_PORT || 3306),
    user: process.env.STAGING_LOAD_DB_USER || 'root',
    password: required('STAGING_LOAD_DB_PASSWORD'),
    database: required('STAGING_LOAD_DB_NAME'),
  });
  const runIds = configuredRunIds();
  const patterns = runIds.length
    ? runIds.map((runId) => `render-load-${runId}-%@staging.ayahx.invalid`)
    : ['render-load-%@staging.ayahx.invalid'];
  const userPredicate = patterns.map(() => 'email LIKE ?').join(' OR ');
  try {
    const [userRows] = await connection.query<Array<RowDataPacket & { id: string }>>(
      `SELECT id FROM users WHERE ${userPredicate}`,
      patterns,
    );
    const userIds = userRows.map((row) => row.id);
    let jobIds: string[] = [];
    let outputPaths: string[] = [];
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      const [jobRows] = await connection.query<Array<RowDataPacket & { id: string; output_path: string | null }>>(
        `SELECT id, output_path FROM render_jobs WHERE user_id IN (${marks})`,
        userIds,
      );
      jobIds = jobRows.map((row) => row.id);
      outputPaths = jobRows.flatMap((row) => row.output_path?.startsWith('s3://') ? [row.output_path] : []);
      if (jobIds.length) {
        const jobMarks = jobIds.map(() => '?').join(',');
        await connection.query(`DELETE FROM render_job_audit WHERE job_id IN (${jobMarks})`, jobIds);
        await connection.query(`DELETE FROM render_jobs WHERE id IN (${jobMarks})`, jobIds);
      }
      await connection.query(`DELETE FROM daily_cloud_render_usage WHERE user_id IN (${marks})`, userIds);
      await connection.query(`DELETE FROM subscriptions WHERE user_id IN (${marks})`, userIds);
      await connection.query(`DELETE FROM profiles WHERE user_id IN (${marks})`, userIds);
      await connection.query(`DELETE FROM user_roles WHERE user_id IN (${marks})`, userIds);
      await connection.query(`DELETE FROM users WHERE id IN (${marks})`, userIds);
    }
    let objects = 0;
    if (outputPaths.length) {
      const s3 = new S3Client({
        region: required('STAGING_LOAD_OBJECT_STORAGE_REGION'),
        endpoint: required('STAGING_LOAD_OBJECT_STORAGE_ENDPOINT'),
        forcePathStyle: process.env.STAGING_LOAD_OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
        credentials: { accessKeyId: required('STAGING_LOAD_OBJECT_STORAGE_ACCESS_KEY_ID'), secretAccessKey: required('STAGING_LOAD_OBJECT_STORAGE_SECRET_ACCESS_KEY') },
      });
      const keys = outputPaths.map((outputPath) => ({ Key: outputPath.replace(/^s3:\/\/[^/]+\//, '') }));
      for (let start = 0; start < keys.length; start += 1000) {
        const batch = keys.slice(start, start + 1000);
        await s3.send(new DeleteObjectsCommand({
          Bucket: required('STAGING_LOAD_OBJECT_STORAGE_BUCKET'),
          Delete: { Objects: batch, Quiet: true },
        }));
        objects += batch.length;
      }
    }
    console.log(JSON.stringify({ runIds: runIds.length ? runIds : 'all', users: userIds.length, jobs: jobIds.length, objects }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
