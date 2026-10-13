// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {CatalogLicensedChapterReadiness,createLicensedPublicationDetails,scopedLicensedChapterProof,validLicensedPublicationDetails} from '../../server/services/catalogLicensedReadiness';
import {CatalogLicensedSourceResolver,type HostedAudioPlan} from '../../server/services/licensedSourceResolver';
import {technicalPublicationDecision} from '../../server/services/catalogTechnicalPublication';
import {planScopedTechnicalPublication} from '../../server/services/catalogLicensedPublicationPlanner';
import {RecitationCatalogService} from '../../server/services/recitationCatalogService';
import type {CatalogDatabase,CatalogRow} from '../../server/services/catalogContracts';
const now=Date.parse('2026-10-10T12:00:00Z'),sha='a'.repeat(64),url='https://owned.example/recitation.mp3';
const samples=[{surah:1,ayah:1,chapterAyahCount:7,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:1,ayah:4,chapterAyahCount:7,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:2,ayah:2,chapterAyahCount:286,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:2,ayah:100,chapterAyahCount:286,ncc:.98,durationDifferenceMs:0,lagMs:0},{surah:3,ayah:199,chapterAyahCount:200,ncc:.98,durationDifferenceMs:0,lagMs:0}];
const offset={method:'v1' as const,sourceSha256:sha,recitationId:'rec-1',qudVersion:'v3.2.0',sourceSurah:1,sourceChapterOffsetMs:1000,protocol:'distributed_3_surahs_interior_300ms' as const,samples};
const plan:HostedAudioPlan={kind:'licensed_file',recitationId:'rec-1',surah:1,sourceId:'source-1',storageObjectId:null,adapter:'url_reference',url,allowedHosts:['owned.example'],sha256:sha,durationMs:3000,sourceChapterOffsetMs:1000,offsetEvidence:offset,rightsRef:'human-rights-1'};
const timing={ayah:1,coordinate:'source_ms' as const,source:'qud',source_offset_ms:0,words:[[1,0,0,1000]] as [number,number,number,number][]};
const proof=()=>scopedLicensedChapterProof(plan,[timing],1,true)!;
function dbRead(read:(sql:string,params?:unknown[])=>Promise<CatalogRow[]>):CatalogDatabase{return {read,execute:vi.fn(),transaction:vi.fn()};}
describe('scoped licensed publication (unit fixtures, not live R2)',()=>{
  it('publishes technically with one live complete licensed anchor without granting global catalog offset or human/public fields',()=>{
    const row={id:'rec-1',channel:'youtube',status:'needs_review',riwayah_code:'hafs_an_asim',canonical_text_available:1,offset_verified:0,verification_status:'failed',verification_method:'v1',offset_check_score:.4,timing_level:'word',timing_quality:'verified',audio_mode:'surah_slice',is_public:0,voice_identity_status:'unverified'};
    const before=structuredClone(row),details=createLicensedPublicationDetails('rec-1',[proof()],now);
    expect(technicalPublicationDecision(row,{completeChapters:1,healthyCompleteChapters:0,coverageMismatches:0,links:114,healthyLinks:0,youtube:true,sameAudioConflict:false,licensedPublicationDetails:details,asOfMs:now})).toEqual({eligible:true,reasons:[]});expect(row).toEqual(before);
  });
  it.each(['expired','future','actor','wrong_recitation','bad_sha','missing_rights','incomplete','coverage','lag','duration','sample_count','word_end','duplicate','v1_low_score'])('rejects invalid snapshot %s',kind=>{
    const s=createLicensedPublicationDetails('rec-1',[proof()],now)!;
    if(kind==='expired')s.expires_at_epoch_ms=now;if(kind==='future')s.checked_at_epoch_ms=now+1;if(kind==='actor')s.actor='browser' as typeof s.actor;if(kind==='wrong_recitation')s.recitation_id='other';if(kind==='bad_sha')s.chapters[0].source_sha256='wrong';if(kind==='missing_rights')s.chapters[0].rights_ref='';if(kind==='incomplete')s.chapters[0].ready_ayahs=0;if(kind==='coverage')s.chapters[0].coverage_mismatch=1;if(kind==='lag')s.chapters[0].maximum_absolute_lag_ms=31;if(kind==='duration')s.chapters[0].maximum_duration_difference_ms=31;if(kind==='sample_count')s.chapters[0].sample_count=4;if(kind==='word_end')s.chapters[0].last_word_ms=4000;if(kind==='duplicate'){s.chapters.push({...s.chapters[0]});s.complete_chapter_count=2;}if(kind==='v1_low_score')s.chapters[0].minimum_score=.94;
    expect(validLicensedPublicationDetails(s,'rec-1',now)).toBe(false);
  });
  it('anchors exactly one chapter and rejects a too-short file rather than declaring other chapters verified',()=>{
    expect(scopedLicensedChapterProof({...plan,durationMs:1969},[timing],1,true)).toBeNull();
    const details=createLicensedPublicationDetails('rec-1',[proof(),{...proof(),surah:2}],now)!;expect(details.complete_chapter_count).toBe(1);expect(details.chapters.map(p=>p.surah)).toEqual([1]);
    expect(validLicensedPublicationDetails(details,'rec-1',now+300000)).toBe(false);
  });
  it('resolves a human-licensed hosted reference with exact blob SHA and no storage operation or YouTube request',async()=>{
    const source={checkLink:vi.fn(async()=>({status:'available',httpStatus:200,checkedAt:new Date(now).toISOString()})),verifyLicensedBlob:vi.fn(async()=>{})};
    const row={source_id:'source-1',recitation_id:'rec-1',surah:1,url,rights_ref:'human-rights-1',source_sha256:sha,source_duration_ms:3000,verification_status:'verified',verification_details:{...offset,hosted_source:{allowed_hosts:['owned.example'],url_sha256:createHash('sha256').update(url).digest('hex')}},storage_id:null};
    const db=dbRead(vi.fn(async sql=>{expect(sql).toContain("h.status='approved'");expect(sql).toContain('COALESCE(h.target_subject_id,h.subject_id)=u.recitation_id');expect(sql).toContain('NOT EXISTS(SELECT 1 FROM human_review_items newer WHERE newer.supersedes_id=h.id)');return [row];}));
    const resolved=await new CatalogLicensedSourceResolver(db,null,source).resolveLicensedSource('rec-1',1);expect(resolved).toMatchObject({adapter:'url_reference',url,sha256:sha,sourceChapterOffsetMs:1000});expect(source.verifyLicensedBlob).toHaveBeenCalledWith(url,['owned.example'],sha);
  });
  it('propagates a changed hosted blob error without provider fallback',async()=>{
    const row={source_id:'source-1',recitation_id:'rec-1',surah:1,url,rights_ref:'human-rights-1',source_sha256:sha,source_duration_ms:3000,verification_status:'verified',verification_details:{...offset,hosted_source:{allowed_hosts:['owned.example'],url_sha256:createHash('sha256').update(url).digest('hex')}},storage_id:null};
    const changed=new Error('ACTUAL_BLOB_CHANGED'),source={checkLink:vi.fn(async()=>({status:'available',httpStatus:200,checkedAt:new Date(now).toISOString()})),verifyLicensedBlob:vi.fn(async()=>{throw changed;})};
    await expect(new CatalogLicensedSourceResolver(dbRead(async()=>[row]),null,source).resolveLicensedSource('rec-1',1)).rejects.toBe(changed);
  });
  it('requires all canonical ayahs and ready word coverage for a complete chapter',async()=>{
    let rows:CatalogRow[]=[{...timing,review_status:'ready',review_reasons:[],coverage_words:1,expected_words:1,missing_words:[]}];
    const db=dbRead(async sql=>sql.includes('JOIN quran_surahs')?[{surah:1,availability_state:'complete',coverage_mismatch:0,expected_ayahs:1}]:rows);
    const resolver={resolveLicensedSource:vi.fn(async()=>plan)},gate=new CatalogLicensedChapterReadiness(db,resolver);
    expect(await gate.isChapterReady('rec-1',1)).toBe(true);rows=[{...rows[0],coverage_words:0}];expect(await gate.isChapterReady('rec-1',1)).toBe(false);rows=[];expect(await gate.isChapterReady('rec-1',1)).toBe(false);
  });
  it('shows only the licensed YouTube chapter and rejects availability for another complete timing-only chapter',async()=>{
    const db=dbRead(async sql=>sql.includes('FROM recitations r JOIN audio_providers')?[{id:'rec-1',slug:'youtube-recording',status:'published',is_public:1,voice_identity_status:'confirmed',license_status:'permitted',channel:'youtube'}]:[{surah:1,availability_state:'complete',available_runs:[[1,1]]},{surah:2,availability_state:'complete',available_runs:[[1,1]]}]);
    const gate={isChapterReady:vi.fn(async(_id:string,surah:number)=>surah===1)};
    const service=new RecitationCatalogService(db,async()=>({enabled:true,availabilityMode:'complete_only'}),{resolveAudioPlan:vi.fn()},gate);
    expect((await service.listSurahsForRecitation('youtube-recording')).map(c=>c.surah)).toEqual([1]);
    const single=dbRead(async sql=>sql.includes('FROM recitations r JOIN audio_providers')?[{id:'rec-1',status:'published',is_public:1,voice_identity_status:'confirmed',license_status:'permitted',channel:'youtube'}]:[{surah:2,availability_state:'complete',available_runs:[[1,1]]}]);
    await expect(new RecitationCatalogService(single,async()=>({enabled:true,availabilityMode:'complete_only'}),{resolveAudioPlan:vi.fn()},gate).getAvailability('youtube-recording',2)).rejects.toMatchObject({code:'YOUTUBE_RENDER_REQUIRES_LICENSED_FILE',status:409});
  });
  it('honors flag OFF before any inventory or licensed network operation',async()=>{
    const db=dbRead(vi.fn()),gate={isChapterReady:vi.fn()},audio={resolveAudioPlan:vi.fn()},service=new RecitationCatalogService(db,async()=>({enabled:false,availabilityMode:'complete_only'}),audio,gate);
    await expect(service.listSurahsForRecitation('x')).rejects.toMatchObject({code:'QURAN_CATALOG_DISABLED',status:404});await expect(service.resolveAudioPlan({recitationId:'x',surah:1,from:1,to:1})).rejects.toMatchObject({code:'QURAN_CATALOG_DISABLED',status:404});expect(db.read).not.toHaveBeenCalled();expect(gate.isChapterReady).not.toHaveBeenCalled();
  });
  it('plans only scoped mode/quality/cache and publication, never global offset or human fields, and replays with no timestamp churn',()=>{
    const row={id:'rec-1',status:'needs_review',riwayah_code:'hafs_an_asim',canonical_text_available:1,audio_mode:'unverified_source',timing_quality:'unverified',timing_level:'word',offset_verified:0,verification_status:'failed',verification_method:'v1',is_public:0,voice_identity_status:'confirmed'};
    const facts={completeChapters:1,healthyCompleteChapters:0,coverageMismatches:0,links:114,healthyLinks:0,youtube:true,sameAudioConflict:false},details=createLicensedPublicationDetails('rec-1',[proof()],now)!;
    const result=planScopedTechnicalPublication(row,facts,details,now);expect(result.decision.eligible).toBe(true);expect(result.patch).toMatchObject({audio_mode:'surah_slice',timing_quality:'verified',status:'published',published_by:'rule-v1',licensed_publication_details:details});expect(Object.keys(result.patch)).not.toEqual(expect.arrayContaining(['offset_verified','verification_method','voice_identity_status','is_public']));
    const replay=planScopedTechnicalPublication({...row,...result.patch,status:'published'},facts,createLicensedPublicationDetails('rec-1',[proof()],now+1000),now+1000);expect(replay.patch).toEqual({});
    const noFile=planScopedTechnicalPublication(row,facts,null,now);expect(noFile.patch).toEqual({});expect(noFile.decision.reasons).toContain('YOUTUBE_RENDER_REQUIRES_LICENSED_FILE');
  });
  it('retains a human publication stamp while refreshing only expired scoped evidence',()=>{
    const details=createLicensedPublicationDetails('rec-1',[proof()],now)!,row={id:'rec-1',status:'published',published_by:'human-1',published_at:'2026-01-01',riwayah_code:'hafs_an_asim',canonical_text_available:1,audio_mode:'surah_slice',timing_quality:'verified',timing_level:'word',offset_verified:0,verification_status:'failed',licensed_publication_details:details};
    const facts={completeChapters:1,healthyCompleteChapters:0,coverageMismatches:0,links:114,healthyLinks:0,youtube:true,sameAudioConflict:false};
    const result=planScopedTechnicalPublication(row,facts,createLicensedPublicationDetails('rec-1',[proof()],now+300001),now+300001);expect(Object.keys(result.patch)).toEqual(['licensed_publication_details']);expect(row.published_by).toBe('human-1');
  });
});
