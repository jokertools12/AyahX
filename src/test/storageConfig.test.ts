import { describe, expect, it } from 'vitest';
import { resolveStorageConfig } from '../../server/config';

describe('S3-compatible storage configuration', () => {
  it('keeps local storage as the default until the driver is explicitly enabled', () => {
    const storage = resolveStorageConfig({
      R2_BUCKET_NAME: 'ayahx-audio-staging',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
    });

    expect(storage.driver).toBe('local');
    expect(storage.bucket).toBe('ayahx-audio-staging');
  });

  it('accepts the deployment guide aliases when S3 mode is selected', () => {
    const storage = resolveStorageConfig({
      OBJECT_STORAGE_DRIVER: 's3',
      R2_BUCKET_NAME: 'ayahx-audio-staging',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_FORCE_PATH_STYLE: 'true',
      R2_PUBLIC_DOMAIN: 'https://cdn.example.test',
    });

    expect(storage).toEqual({
      driver: 's3',
      bucket: 'ayahx-audio-staging',
      region: 'auto',
      endpoint: 'https://example.r2.cloudflarestorage.com',
      forcePathStyle: true,
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      publicBaseUrl: 'https://cdn.example.test',
    });
  });

  it('prefers the canonical application names over aliases', () => {
    const storage = resolveStorageConfig({
      OBJECT_STORAGE_DRIVER: 's3',
      OBJECT_STORAGE_BUCKET: 'canonical',
      R2_BUCKET_NAME: 'alias',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'canonical-access',
      R2_ACCESS_KEY_ID: 'alias-access',
    });

    expect(storage.bucket).toBe('canonical');
    expect(storage.accessKeyId).toBe('canonical-access');
  });
});
