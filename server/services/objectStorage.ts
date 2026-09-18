import fs from 'fs';
import path from 'path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!config.storage.bucket || !config.storage.accessKeyId || !config.storage.secretAccessKey) {
    throw new Error('Object storage credentials are incomplete');
  }
  if (!client) client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey },
  });
  return client;
}

export function isObjectStoragePath(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith('s3://'));
}

export function objectKeyFromPath(value: string): string {
  return value.replace(/^s3:\/\/[^/]+\//, '');
}

export async function uploadRender(localPath: string, userId: string, jobId: string): Promise<string> {
  const key = `renders/${userId}/${jobId}.mp4`;
  await getClient().send(new PutObjectCommand({
    Bucket: config.storage.bucket!, Key: key, Body: fs.createReadStream(localPath), ContentType: 'video/mp4',
  }));
  return `s3://${config.storage.bucket}/${key}`;
}

export async function signedRenderDownload(storagePath: string, filename: string): Promise<{ url: string; size: number | null }> {
  const key = objectKeyFromPath(storagePath);
  const head = await getClient().send(new HeadObjectCommand({ Bucket: config.storage.bucket!, Key: key }));
  const url = await getSignedUrl(getClient(), new GetObjectCommand({
    Bucket: config.storage.bucket!, Key: key, ResponseContentType: 'video/mp4', ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '')}"`,
  }), { expiresIn: 900 });
  return { url, size: head.ContentLength ?? null };
}

export async function deleteStoredRender(storagePath: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: config.storage.bucket!, Key: objectKeyFromPath(storagePath) }));
}

export function safeLocalRenderPath(storageRoot: string, userId: string, filename: string): string {
  return path.join(storageRoot, userId, path.basename(filename));
}
