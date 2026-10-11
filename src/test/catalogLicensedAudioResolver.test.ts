// @vitest-environment node
// Unit contracts only: mock storage is not acceptance evidence for R2/S3.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {MockInstance} from 'vitest';
import {RecitationAudioResolver} from '../../server/services/recitationAudioResolver';
import {CatalogAudioSource} from '../../server/services/catalogAudioSource';
import * as timeline from '../../shared/timing/toRenderTimeline';
import type {CatalogDatabase,CatalogRow,CatalogSettings,CatalogTx} from '../../server/services/catalogContracts';
import type {AudioObjectStorage} from '../../server/services/catalogStorageContracts';
import type {LicensedOffsetEvidence} from '../../server/services/licensedAudioVerification';
import type {StorageAudioPlan} from '../../server/services/licensedSourceResolver';

const sha='a'.repeat(64),providerUrl='https://www.youtube.com/watch?v=abcdefghijk',signedUnitUrl='https://storage.invalid/fixture?X-Amz-Signature=unit-only';
const base:CatalogRow={id:'r1',reciter_id:'reader',slug:'recording',audio_mode:'surah_slice',offset_verified:0,verification_status:'failed',verification_method:'v1',offset_check_score:.5,riwayah_code:'hafs_an_asim',provider:'youtube',host_allowlist:['youtube.com'],license_text:null,attribution_text:'Owner attribution'};
const chapter:CatalogRow={audio_url:providerUrl,chapter_offset_ms:999999,availability_state:'complete',available_runs:[[1,2]],coverage_mismatch:0};
const timings:CatalogRow[]=[1,2].map(ayah=>({ayah,coordinate:'source_ms',source:'qud',source_offset_ms:null,words:[[1,0,ayah*1000,ayah*1000+500]],review_status:'ready',review_reasons:[],coverage_words:1,expected_words:1,missing_words:[]}));
function proof():LicensedOffsetEvidence{return {method:'v1',sourceSha256:sha,recitationId:'r1',sourceSurah:1,sourceChapterOffsetMs:60000,qudVersion:'v3.2.0',protocol:'distributed_3_surahs_interior_300ms',samples:[{surah:1,ayah:1,chapterAyahCount:7,ncc:.95,durationDifferenceMs:30,lagMs:30},{surah:1,ayah:4,chapterAyahCount:7,ncc:.99,durationDifferenceMs:0,lagMs:0},{surah:36,ayah:2,chapterAyahCount:83,ncc:.99,durationDifferenceMs:0,lagMs:0},{surah:36,ayah:70,chapterAyahCount:83,ncc:.99,durationDifferenceMs:0,lagMs:0},{surah:112,ayah:4,chapterAyahCount:4,ncc:.99,durationDifferenceMs:0,lagMs:0}]};}
function licensed():StorageAudioPlan{return {kind:'licensed_file',recitationId:'r1',surah:1,sourceId:'source-1',storageObjectId:'object-1',adapter:'r2',bucket:'unit-bucket',objectKey:`licensed/recording/001/${sha}.wav`,sha256:sha,durationMs:63000,sourceChapterOffsetMs:60000,offsetEvidence:proof()};}
function fixture(plan:StorageAudioPlan|null=licensed(),record:CatalogRow=base,chapterRow:CatalogRow=chapter,ayahRows:CatalogRow[]=timings,configured=true){
  const read=vi.fn(async(sql:string,params:unknown[]=[])=>{
    if(sql.includes('FROM recitations r JOIN audio_providers p'))return [record];
    if(sql.includes('FROM recitation_chapters'))return [chapterRow];
    if(sql.includes('FROM ayah_timings'))return ayahRows.filter(t=>Number(t.ayah)>=Number(params[2])&&Number(t.ayah)<=Number(params[3]));
    if(sql.startsWith('SELECT a.hash'))return [];
    throw new Error('UNEXPECTED_LICENSED_BRANCH_QUERY');
  });
  const execute=vi.fn(async(_sql:string,_params?:unknown[])=>{});const transaction=vi.fn(async(work:(tx:CatalogTx)=>Promise<unknown>)=>work(db));const db:CatalogDatabase={read,execute,transaction:async<T>(work:(tx:CatalogTx)=>Promise<T>)=>await transaction(work) as T};
  const source=new CatalogAudioSource(),check=vi.spyOn(source,'checkLink').mockRejectedValue(new Error('PROVIDER_FETCH_FORBIDDEN_IN_UNIT')),fingerprint=vi.spyOn(source,'verifyRecordingFingerprint').mockRejectedValue(new Error('PROVIDER_FETCH_FORBIDDEN_IN_UNIT'));
  const presignGet=vi.fn(async()=>({url:signedUnitUrl,expiresAt:'2026-10-10T12:15:00.000Z',requiredHeaders:{}}));
  const storage={adapter:'r2',bucket:'unit-bucket',presignGet} as unknown as AudioObjectStorage;
  const resolveLicensedSource=vi.fn(async()=>plan),settings:CatalogSettings={enabled:true,availabilityMode:'complete_only',voiceGatePolicy:'allow_auto_verified'};
  return {resolver:new RecitationAudioResolver(db,source,async()=>settings,configured?{resolver:{resolveLicensedSource},storage}:undefined),read,execute,transaction,check,fingerprint,presignGet,resolveLicensedSource};
}
const input={recitationId:'r1',surah:1,from:1,to:2};
let conversion:MockInstance<typeof timeline.toRenderTimeline>;
beforeEach(()=>{conversion=vi.spyOn(timeline,'toRenderTimeline');vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('NETWORK_FORBIDDEN_IN_UNIT');}));});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('licensed RecitationAudioResolver branch — units, no live object storage',()=>{
  it.each([false,true])('YouTube without a licensed file fails explicitly before audio or timing access (configured=%s)',async configured=>{
    const f=fixture(null,base,chapter,timings,configured);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE',status:409});
    expect(f.read).toHaveBeenCalledTimes(1);expect(conversion).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();expect(f.presignGet).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('uses the measured licensed chapter base exactly once and mints only a short response capability',async()=>{
    const plan=licensed(),f=fixture(plan),result=await f.resolver.resolveAudioPlan(input);
    expect(f.resolveLicensedSource).toHaveBeenCalledWith('r1',1);expect(conversion).toHaveBeenCalledTimes(1);expect(conversion).toHaveBeenCalledWith(expect.any(Array),{chapterOffsetMs:plan.offsetEvidence.sourceChapterOffsetMs,sourceFormat:'qud_release',padMs:150});
    expect(result).toMatchObject({recitationId:'r1',provider:'licensed_file',license:'admin_owned_or_licensed',attribution:'Owner attribution',coordinate:'source_ms',fallbackUsed:true,fallbackReason:'EXPLICIT_LICENSED_SAME_RECORDING',alternateSourceId:'source-1',parts:[{url:signedUnitUrl,sliceFromMs:60850,sliceToMs:62500}]});
    expect(f.presignGet).toHaveBeenCalledExactlyOnceWith(plan.objectKey,900);expect(f.check).not.toHaveBeenCalled();expect(f.fingerprint).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();expect(f.transaction).toHaveBeenCalledOnce();expect(f.execute).toHaveBeenCalledOnce();expect(f.execute.mock.calls[0][0]).toContain('INSERT INTO audit_logs');expect(f.execute.mock.calls[0][1]?.[3]).toBe('recitation.licensed_source_used');expect(JSON.stringify(f.execute.mock.calls)).not.toContain(signedUnitUrl);expect(JSON.stringify(f.execute.mock.calls)).not.toContain(providerUrl);expect(JSON.stringify(result)).not.toContain(providerUrl);
  });
  it('applies the requested crop to licensed source coordinates without the provider chapter base',async()=>{
    const f=fixture(),result=await f.resolver.resolveAudioPlan({...input,from:2,to:2,padMs:50});expect(result.parts[0]).toMatchObject({sliceFromMs:61950,sliceToMs:62500});expect(conversion).toHaveBeenCalledTimes(1);expect(f.check).not.toHaveBeenCalled();
  });
  it('rejects a plan chapter offset that contradicts its measured proof before conversion',async()=>{
    const plan=licensed();plan.sourceChapterOffsetMs=0;const f=fixture(plan);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'LICENSED_OFFSET_NOT_VERIFIED'});expect(conversion).not.toHaveBeenCalled();expect(f.presignGet).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();
  });
  it.each([NaN,Infinity,0,-1])('rejects invalid licensed duration %s before conversion or signing',async duration=>{
    const plan=licensed();plan.durationMs=duration;const f=fixture(plan);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'LICENSED_OFFSET_NOT_VERIFIED'});expect(conversion).not.toHaveBeenCalled();expect(f.presignGet).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['recitation','surah','sha','proof_recitation','proof_surah','samples','duplicate_sample','raw_ncc','lag','duration','unknown_offset'] as const)('rejects a licensed contract with %s mismatch before URL signing',async mismatch=>{
    const plan=licensed();switch(mismatch){case 'recitation':plan.recitationId='other';break;case 'surah':plan.surah=2;break;case 'sha':plan.sha256='b'.repeat(64);break;case 'proof_recitation':plan.offsetEvidence.recitationId='other';break;case 'proof_surah':plan.offsetEvidence.sourceSurah=2;break;case 'samples':plan.offsetEvidence.samples.pop();break;case 'duplicate_sample':plan.offsetEvidence.samples[4]={...plan.offsetEvidence.samples[0]};break;case 'raw_ncc':plan.offsetEvidence.samples[0].ncc=.949999997;break;case 'lag':plan.offsetEvidence.samples[0].lagMs=30.000001;break;case 'duration':plan.offsetEvidence.samples[0].durationDifferenceMs=30.000001;break;case 'unknown_offset':plan.offsetEvidence.sourceChapterOffsetMs=NaN;break;}
    const f=fixture(plan);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'LICENSED_OFFSET_NOT_VERIFIED',status:409});expect(conversion).not.toHaveBeenCalled();expect(f.presignGet).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('v2 without explicit human codec exception is not promoted by a licensed file',async()=>{
    const plan=licensed();plan.offsetEvidence.method='v2';for(const sample of plan.offsetEvidence.samples)sample.vadAgreement=.95;
    const f=fixture(plan);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'LICENSED_V2_REQUIRES_HUMAN_ACCEPTANCE'});expect(f.presignGet).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();
  });
  it('rejects a file more than 30ms shorter than the requested source window before signing',async()=>{
    const plan=licensed();plan.durationMs=62469;const f=fixture(plan);await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'LICENSED_TIMING_COORDINATES_INVALID'});expect(conversion).toHaveBeenCalledTimes(1);expect(f.presignGet).not.toHaveBeenCalled();expect(f.check).not.toHaveBeenCalled();
  });
  it('does not borrow Hafs timing for another riwayah even with a licensed file',async()=>{
    const f=fixture(licensed(),{...base,riwayah_code:'warsh_an_nafi'});await expect(f.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'TIMINGS_INCOMPLETE'});expect(conversion).not.toHaveBeenCalled();expect(f.presignGet).not.toHaveBeenCalled();
  });
  it('keeps chapter coverage and ready-word gates before licensed URL creation',async()=>{
    const mismatch=fixture(licensed(),base,{...chapter,coverage_mismatch:1});await expect(mismatch.resolver.resolveAudioPlan(input)).rejects.toMatchObject({code:'RANGE_NOT_AVAILABLE'});expect(mismatch.presignGet).not.toHaveBeenCalled();
    const missing=fixture(licensed(),base,chapter,[{...timings[0],coverage_words:0,missing_words:[[1,'MISSING_WORD']]}]);await expect(missing.resolver.resolveAudioPlan({...input,to:1})).rejects.toMatchObject({code:'TIMINGS_INCOMPLETE'});expect(missing.presignGet).not.toHaveBeenCalled();expect(conversion).not.toHaveBeenCalled();
  });
  it('propagates licensed signer failure without trying YouTube or another recording',async()=>{
    const f=fixture();f.presignGet.mockRejectedValue(new Error('STORAGE_SIGNING_FAILED'));await expect(f.resolver.resolveAudioPlan(input)).rejects.toThrow('STORAGE_SIGNING_FAILED');expect(f.check).not.toHaveBeenCalled();expect(f.fingerprint).not.toHaveBeenCalled();expect(globalThis.fetch).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled();
  });
});
