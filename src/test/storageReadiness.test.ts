import { describe, expect, it } from 'vitest';
import { getStorageReadiness, resolveStorageConfig } from '../../server/config';

describe('object storage readiness', () => {
  it('treats local storage as ready without cloud credentials', () => {
    expect(getStorageReadiness(resolveStorageConfig({}))).toEqual({ ready: true, driver: 'local' });
  });

  it('fails closed when S3 mode is missing a required connection field', () => {
    const storage = resolveStorageConfig({ OBJECT_STORAGE_DRIVER: 's3', OBJECT_STORAGE_BUCKET: 'staging', OBJECT_STORAGE_FORCE_PATH_STYLE: 'true' });
    expect(getStorageReadiness(storage)).toEqual({
      ready: false,
      driver: 's3',
      missing: ['endpoint', 'accessKeyId', 'secretAccessKey'],
    });
  });

  it('accepts a complete S3-compatible connection without requiring a public URL', () => {
    const storage = resolveStorageConfig({
      OBJECT_STORAGE_DRIVER: 's3',
      OBJECT_STORAGE_BUCKET: 'staging',
      OBJECT_STORAGE_ENDPOINT: 'https://example.test',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
    });
    expect(getStorageReadiness(storage)).toEqual({ ready: true, driver: 's3' });
  });

  it('allows standard AWS S3 to resolve its regional endpoint', () => {
    const storage = resolveStorageConfig({
      OBJECT_STORAGE_DRIVER: 's3', OBJECT_STORAGE_BUCKET: 'aws-bucket',
      OBJECT_STORAGE_REGION: 'us-east-1', OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret', OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
    });
    expect(getStorageReadiness(storage)).toEqual({ ready: true, driver: 's3' });
  });
});
