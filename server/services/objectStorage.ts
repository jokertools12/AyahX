import fs from 'fs';
import path from 'path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
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
  // Upload streams large MP4s as bounded multipart parts while retaining a
  // single request for small files. This avoids buffering a whole render in
  // the API process and leaves no partial object marked as a successful job.
  await new Upload({
    client: getClient(),
    params: { Bucket: config.storage.bucket!, Key: key, Body: fs.createReadStream(localPath), ContentType: 'video/mp4' },
    partSize: 8 * 1024 * 1024,
    queueSize: 2,
    leavePartsOnError: false,
  }).done();
  return `s3://${config.storage.bucket}/${key}`;
}

/**
 * Streams a completed render through the authenticated application response.
 *
 * Do not redirect browser downloads to the object-storage URL here. Some S3
 * compatible providers do not return CORS headers for signed GET requests,
 * which makes an otherwise valid render look like a failed/cancelled file in
 * the browser. Keeping the stream same-origin also protects the signed URL
 * from being exposed to the client.
 */
export async function streamStoredRender(storagePath: string): Promise<{
  body: NodeJS.ReadableStream;
  size: number | null;
  contentType: string;
}> {
  const response = await getClient().send(new GetObjectCommand({
    Bucket: config.storage.bucket!,
    Key: objectKeyFromPath(storagePath),
  }));

  if (!response.Body || typeof (response.Body as any).pipe !== 'function') {
    throw new Error('Object storage returned an empty render body');
  }

  return {
    body: response.Body as NodeJS.ReadableStream,
    size: response.ContentLength ?? null,
    contentType: response.ContentType || 'video/mp4',
  };
}

export async function deleteStoredRender(storagePath: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: config.storage.bucket!, Key: objectKeyFromPath(storagePath) }));
}

export function safeLocalRenderPath(storageRoot: string, userId: string, filename: string): string {
  return path.join(storageRoot, userId, path.basename(filename));
}
