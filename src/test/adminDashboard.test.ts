// @vitest-environment node
import { describe,it,expect,vi,afterEach } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { AdminDashboardService } from '../../server/admin/adminDashboardService';
import type { CatalogDatabase } from '../../server/services/catalogContracts';
afterEach(()=>vi.restoreAllMocks());
const db:CatalogDatabase={read:async sql=>sql.includes('system_settings')?[]:sql.includes('information_schema')?[{allocated_bytes:10,base_bytes:9,timing_bytes:1}]:sql.includes('FROM audit_logs')&&sql.includes('COUNT')?[{total:0}]:sql.includes('FROM audit_logs')?[]:sql.includes('render_engine_capacity')?[]:[{count:0}],execute:async()=>{throw new Error('UNEXPECTED_WRITE');},transaction:async()=>{throw new Error('UNEXPECTED_WRITE');}};
const env={R2_BUCKET:'unit-test-bucket',R2_ENDPOINT:'https://'+'0'.repeat(32)+'.r2.cloudflarestorage.com',R2_ACCOUNT_ID:'0'.repeat(32),R2_READ_ACCESS_KEY_ID:'unit-test-key',R2_READ_SECRET_ACCESS_KEY:'unit-test-secret',STORAGE_VOLUME_BYTES:'5000000000'};
describe('admin R2 read-only health adapter',()=>{
 it('uses a valid HEAD key and treats missing object as connectivity success',async()=>{const send=vi.spyOn(S3Client.prototype,'send').mockRejectedValue({$metadata:{httpStatusCode:404}});const result=await new AdminDashboardService(db,env).get();expect((result.health as Record<string,unknown>).r2).toMatchObject({status:'ok',access:'read_only',method:'HEAD'});expect(send).toHaveBeenCalledTimes(1);const command=send.mock.calls[0][0] as unknown as {input:{Key:string}};expect(command.input.Key).toBe('licensed/ayahx_health/001/'+'0'.repeat(64)+'.mp3');});
 it('reports rejected credentials as unavailable and never exposes SDK error text',async()=>{vi.spyOn(S3Client.prototype,'send').mockRejectedValue({$metadata:{httpStatusCode:403},message:'sensitive-provider-diagnostic'});const result=await new AdminDashboardService(db,env).get();expect((result.health as Record<string,unknown>).r2).toMatchObject({status:'unavailable',code:'STORAGE_REQUEST_FAILED'});expect(JSON.stringify(result)).not.toContain('sensitive-provider-diagnostic');});
});
