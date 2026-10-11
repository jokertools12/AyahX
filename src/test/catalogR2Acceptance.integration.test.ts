// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runAudioStorageAcceptance} from '../../scripts/test-licensed-audio-storage';
import {validateS3AudioConfig} from '../../server/services/catalogObjectStorage';
const names=['R2_TEST_ACCOUNT_ID','R2_TEST_ENDPOINT','R2_TEST_BUCKET','R2_TEST_WRITE_ACCESS_KEY_ID','R2_TEST_WRITE_SECRET_ACCESS_KEY','R2_TEST_READ_ACCESS_KEY_ID','R2_TEST_READ_SECRET_ACCESS_KEY','R2_TEST_ALLOWED_ORIGIN'];
const enabled=process.env.R2_TEST_ALLOW_WRITES==='staging-test-prefix-only'&&names.every(name=>!!process.env[name]);
/** Optional real storage components only. It does not grant full R2/runtime acceptance. */
it.skipIf(!enabled)('real R2 staging test/ multipart, Range, SHA, credential scope and object cleanup',async()=>{
  const env=process.env,bucket=env.R2_TEST_BUCKET!;
  if(!/^ayahx-audio-staging(?:-[a-z0-9-]+)?$/u.test(bucket))throw new Error('R2_TEST_STAGING_BUCKET_REQUIRED');
  const origin=new URL(env.R2_TEST_ALLOWED_ORIGIN!);if(origin.origin!==env.R2_TEST_ALLOWED_ORIGIN||origin.protocol!=='https:')throw new Error('R2_TEST_EXACT_HTTPS_ORIGIN_REQUIRED');
  const config={bucket,endpoint:env.R2_TEST_ENDPOINT!,accountId:env.R2_TEST_ACCOUNT_ID!,access:'read_write' as const,accessKeyId:env.R2_TEST_WRITE_ACCESS_KEY_ID!,secretAccessKey:env.R2_TEST_WRITE_SECRET_ACCESS_KEY!};
  const readerConfig={...config,access:'read_only' as const,accessKeyId:env.R2_TEST_READ_ACCESS_KEY_ID!,secretAccessKey:env.R2_TEST_READ_SECRET_ACCESS_KEY!};
  validateS3AudioConfig(config);validateS3AudioConfig(readerConfig);
  const scratch=await mkdtemp(join(tmpdir(),'ayahx-r2-acceptance-'));
  const report=await runAudioStorageAcceptance({config,readerConfig,scratchRoot:scratch,reportPath:join(scratch,'report.json'),allowedOrigin:origin.origin,mode:'r2'});
  expect(report.actual_r2).toBe(true);expect(report.status).toBe('PASSED_PARTIAL_STORAGE_ACCEPTANCE');expect(report.test_objects_deleted).toBe(true);
  // Browser CORS, day-one lifecycle, offset/AudioPlan/render and billing remain separate gates.
},300000);
