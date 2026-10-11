// @vitest-environment node
import {EventEmitter} from 'node:events';
import {PassThrough,Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {describe,it,expect,vi} from 'vitest';
import {verifyLicensedAudio,type LicensedOffsetEvidence} from '../../server/services/licensedAudioVerification';
import {CatalogStorageAdminService} from '../../server/services/catalogStorageAdminService';
import type {AudioObjectStorage} from '../../server/services/catalogStorageContracts';
import type {CatalogDatabase,CatalogRow} from '../../server/services/catalogContracts';
import type {SourceAyahTiming} from '../../shared/timing/toRenderTimeline';

// Only the subprocess probe is mocked. Verification still streams/hashes bytes
// and calculates the source timeline; these are unit tests, not cloud acceptance.
const probe=vi.hoisted(()=>({durationSeconds:'1'}));
vi.mock('../../server/services/ffmpegBinary',()=>({getFfprobeBinary:()=> 'unit-ffprobe'}));
vi.mock('node:child_process',()=>({spawn:()=>{
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
  queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({format:{format_name:'wav',duration:probe.durationSeconds},streams:[{codec_type:'audio',codec_name:'pcm_s16le',sample_rate:'16000',channels:1}]})));child.emit('close',0);});
  return child;
}}));
const bytes=Buffer.alloc(44);bytes.write('RIFF');bytes.write('WAVE',8);
const sha=createHash('sha256').update(bytes).digest('hex');
const timing:SourceAyahTiming={ayah:1,coordinate:'source_ms',source:'qud',source_offset_ms:null,words:[[1,0,0,500]]};
const proof=():LicensedOffsetEvidence=>({method:'v1',sourceSha256:sha,recitationId:'unit-recitation',sourceSurah:1,sourceChapterOffsetMs:1000,qudVersion:'v3.2.0',protocol:'distributed_3_surahs_interior_300ms',samples:[{surah:1,ayah:1,chapterAyahCount:7,ncc:1,lagMs:0,durationDifferenceMs:0},{surah:1,ayah:4,chapterAyahCount:7,ncc:1,lagMs:0,durationDifferenceMs:0},{surah:2,ayah:1,chapterAyahCount:286,ncc:1,lagMs:0,durationDifferenceMs:0},{surah:2,ayah:4,chapterAyahCount:286,ncc:1,lagMs:0,durationDifferenceMs:0},{surah:3,ayah:1,chapterAyahCount:200,ncc:1,lagMs:0,durationDifferenceMs:0}]});
const storage=():AudioObjectStorage=>({adapter:'r2',bucket:'unit-bucket',head:vi.fn(async()=>({sizeBytes:bytes.length,contentType:'audio/wav',etag:null})),read:vi.fn(async()=>({body:Readable.from(bytes),head:{sizeBytes:bytes.length,contentType:'audio/wav',etag:null}})),presignGet:vi.fn(),presignPut:vi.fn(),beginMultipart:vi.fn(),presignPart:vi.fn(),listParts:vi.fn(),completeMultipart:vi.fn(),abortMultipart:vi.fn(),listObjects:vi.fn(),deleteObject:vi.fn()});
const spec={objectKey:`licensed/unit/001/${sha}.wav`,sha256:sha,sizeBytes:bytes.length,contentType:'audio/wav'};
describe('licensed verification rejects a source shorter than its measured source timeline',()=>{
  it.each(['1','1.469'])('rejects duration %ss with otherwise valid hash/probe/offset',async duration=>{
    probe.durationSeconds=duration;const scratchRoot=await mkdtemp(join(tmpdir(),'ayahx-short-audio-unit-'));
    await expect(verifyLicensedAudio(storage(),{spec,recitationId:'unit-recitation',surah:1,timings:[timing],scratchRoot},{verify:async()=>proof()})).rejects.toMatchObject({code:'LICENSED_TIMING_COORDINATES_INVALID',status:409});
  });
  it.each(['1.470','1.500','2.000'])('accepts duration %ss at/within the 30ms bound or with trailing audio',async duration=>{
    probe.durationSeconds=duration;const scratchRoot=await mkdtemp(join(tmpdir(),'ayahx-short-audio-unit-'));
    const result=await verifyLicensedAudio(storage(),{spec,recitationId:'unit-recitation',surah:1,timings:[timing],scratchRoot},{verify:async()=>proof()});expect(result.durationMs).toBe(Number(duration)*1000);
  });
  it('records rejection without verifying, replacing the pointer, soft-deleting the old source or enqueueing voice approval',async()=>{
    probe.durationSeconds='1';const scratchRoot=await mkdtemp(join(tmpdir(),'ayahx-short-audio-unit-'));
    const uploaded:CatalogRow={id:'new-object',adapter:'r2',bucket:'unit-bucket',object_key:spec.objectKey,sha256:sha,size_bytes:bytes.length,content_type:'audio/wav',recitation_id:'unit-recitation',surah:1,rights_ref:'human-rights',upload_status:'uploaded'};
    const old={id:'old-object',upload_status:'verified'},pointer={storage_object_id:'old-object',is_active:1};
    const read=vi.fn(async(sql:string):Promise<CatalogRow[]>=>sql.includes('FROM storage_objects')?[uploaded]:sql.includes('FROM human_review_items')?[{status:'approved',decided_by:'human',type:'storage_rights',subject_type:'recitation',subject_id:'unit-recitation'}]:sql.includes('FROM ayah_timings')?[{...timing}]:[]);
    const execute=vi.fn(async(sql:string,params:unknown[]=[])=>{if(sql.startsWith('UPDATE storage_objects SET upload_status=\'rejected\'')){uploaded.upload_status='rejected';uploaded.rejection_reason=params[0];}else if(!sql.startsWith('INSERT INTO audit_logs'))throw new Error('UNEXPECTED_SOURCE_MUTATION');});
    const db:CatalogDatabase={read,execute,transaction:async work=>work({read,execute})},enqueueVoiceReverification=vi.fn();
    const service=new CatalogStorageAdminService(db,storage(),{consume:vi.fn()},{verify:async()=>proof()},{enqueueVoiceReverification},scratchRoot);
    await expect(service.verifyUploaded({id:'unit-verifier',kind:'system',permissions:new Set(['storage.verify'])},'new-object')).rejects.toMatchObject({code:'LICENSED_TIMING_COORDINATES_INVALID'});
    expect(uploaded.upload_status).toBe('rejected');expect(uploaded.rejection_reason).toBe('LICENSED_TIMING_COORDINATES_INVALID');expect(old.upload_status).toBe('verified');expect(pointer).toEqual({storage_object_id:'old-object',is_active:1});
    expect(execute.mock.calls.map(([sql])=>sql)).toHaveLength(2);expect(execute.mock.calls[1][1]?.[3]).toBe('storage.verify_rejected');expect(enqueueVoiceReverification).not.toHaveBeenCalled();
    expect(execute.mock.calls.map(([sql])=>sql).join('\n')).not.toMatch(/recitation_source_urls|soft_deleted|upload_status='verified'/u);
  });
});
