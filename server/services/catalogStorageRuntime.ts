import { CatalogError } from './catalogContracts';
import { S3LicensedAudioStorage, UrlReferenceAudioStorage } from './catalogObjectStorage';
import type { AudioObjectStorage, StorageAdapterName } from './catalogStorageContracts';
/** Setting controls selection; credentials alone never activate storage. */
export function catalogStorageFromEnvironment(adapter: StorageAdapterName, access: 'read_only' | 'read_write', hosts: readonly string[], env: NodeJS.ProcessEnv = process.env): AudioObjectStorage {
  if (adapter === 'url_reference') return new UrlReferenceAudioStorage(hosts);
  if (adapter !== 'r2') throw new CatalogError('STORAGE_ADAPTER_INVALID', 503);
  const accessKeyId = access === 'read_only' ? env.R2_READ_ACCESS_KEY_ID : env.R2_ACCESS_KEY_ID;
  const secretAccessKey = access === 'read_only' ? env.R2_READ_SECRET_ACCESS_KEY : env.R2_SECRET_ACCESS_KEY;
  if (!env.R2_BUCKET || !env.R2_ENDPOINT || !env.R2_ACCOUNT_ID || !accessKeyId || !secretAccessKey) throw new CatalogError('STORAGE_CREDENTIALS_UNAVAILABLE', 503);
  return new S3LicensedAudioStorage({ bucket: env.R2_BUCKET, endpoint: env.R2_ENDPOINT, accountId: env.R2_ACCOUNT_ID, access, accessKeyId, secretAccessKey });
}
