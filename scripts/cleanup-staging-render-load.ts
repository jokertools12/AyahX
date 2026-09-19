/** Remove only the disposable load-test data created by staging-render-load.ts. */
import mysql from 'mysql2/promise';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const CONFIRMATION = 'DELETE_STAGING_RENDER_LOAD_DATA';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
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
  const pattern = 'render-load-%@staging.ayahx.invalid';
  try {
    const [userRows] = await connection.query<Array<{ id: string }>>('SELECT id FROM users WHERE email LIKE ?', [pattern]);
    const userIds = userRows.map((row) => row.id);
    let jobIds: string[] = [];
    if (userIds.length) {
      const marks = userIds.map(() => '?').join(',');
      const [jobRows] = await connection.query<Array<{ id: string }>>(`SELECT id FROM render_jobs WHERE user_id IN (${marks})`, userIds);
      jobIds = jobRows.map((row) => row.id);
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

    const s3 = new S3Client({
      region: required('STAGING_LOAD_OBJECT_STORAGE_REGION'),
      endpoint: required('STAGING_LOAD_OBJECT_STORAGE_ENDPOINT'),
      forcePathStyle: process.env.STAGING_LOAD_OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: required('STAGING_LOAD_OBJECT_STORAGE_ACCESS_KEY_ID'), secretAccessKey: required('STAGING_LOAD_OBJECT_STORAGE_SECRET_ACCESS_KEY') },
    });
    let objects = 0;
    // The staging bucket is provisioned specifically for this environment and
    // has no production objects. Listing the common render prefix once avoids
    // 1600 serial per-user list calls after a large load run.
    let continuationToken: string | undefined;
    do {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: required('STAGING_LOAD_OBJECT_STORAGE_BUCKET'), Prefix: 'renders/', ContinuationToken: continuationToken, MaxKeys: 1000 }));
      const keys = (listed.Contents || []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
      if (keys.length) {
        await s3.send(new DeleteObjectsCommand({ Bucket: required('STAGING_LOAD_OBJECT_STORAGE_BUCKET'), Delete: { Objects: keys, Quiet: true } }));
        objects += keys.length;
      }
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
    console.log(JSON.stringify({ users: userIds.length, jobs: jobIds.length, objects }));
  } finally {
    await connection.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
