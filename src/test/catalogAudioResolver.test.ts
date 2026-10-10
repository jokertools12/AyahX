import { describe,it,expect,vi } from 'vitest';
import { CatalogAudioSource,assertCatalogAudioUrl,isPublicAudioAddress } from '../../server/services/catalogAudioSource';
import { RecitationAudioResolver,hasVerifiedCatalogOffset } from '../../server/services/recitationAudioResolver';
import { toRenderTimeline } from '../../shared/timing/toRenderTimeline';
import type { CatalogDatabase,CatalogRow,CatalogSettings } from '../../server/services/catalogContracts';
const hash='a'.repeat(64);const url='https://media.example.com/reader/chapter.mp3';
const base={id:'recitation',reciter_id:'reader',slug:'recording',audio_mode:'surah_slice',offset_verified:1,offset_check_score:.99,verification_status:'passed',verification_method:'v1',verification_details:{},riwayah_code:'hafs_an_asim',host_allowlist:['media.example.com'],provider:'test',license_text:null,attribution_text:null};
const chapter={audio_url:url,chapter_offset_ms:null,availability_state:'complete',available_runs:[[1,2]],coverage_mismatch:0};
const timings=[1,2].map(ayah=>({ayah,source:'qud',coordinate:'source_ms',source_offset_ms:null,words:[[1,0,ayah*1000,ayah*1000+500]],review_status:'ready',review_reasons:[],coverage_words:1,expected_words:1,missing_words:[]}));
function fixture(alternates:CatalogRow[]=[],primaryAvailable=false){
  const read=vi.fn(async(sql:string,params:unknown[]=[])=>{
    if(sql.includes('LEFT JOIN audit_logs'))return [];
    if(sql.includes('FROM recitations r JOIN audio_providers p')&&sql.includes('WHERE r.id=?'))return [base];
    if(sql.includes('suggest')||sql.includes('r.id<>?'))return [{slug:'another-recording-same-reader',availability_state:'complete',available_runs:[[1,2]]}];
    if(sql.includes('FROM recitation_chapters'))return [chapter];if(sql.includes('FROM ayah_timings'))return timings.filter(t=>t.ayah>=Number(params[2])&&t.ayah<=Number(params[3]));
    if(sql.includes('FROM recitation_source_urls'))return alternates;
    throw new Error('UNEXPECTED_TEST_QUERY');
  });
  const execute=vi.fn(async()=>{});const db:CatalogDatabase={read,execute,transaction:work=>work({read,execute})};
  const source=new CatalogAudioSource();const check=vi.spyOn(source,'checkLink').mockImplementation(async raw=>({status:primaryAvailable||raw!==url?'available':'source_unavailable',httpStatus:primaryAvailable||raw!==url?200:404,checkedAt:new Date().toISOString(),finalUrl:raw}));
  const identity=vi.spyOn(source,'verifyRecordingFingerprint').mockResolvedValue();
  let settings:CatalogSettings={enabled:true,availabilityMode:'complete_only'};
  return {resolver:new RecitationAudioResolver(db,source,async()=>settings),check,execute,identity,setMode:()=>{settings={...settings,availabilityMode:'ayah_ranges'};}};
}
describe('D4 source security and one coordinate conversion',()=>{
  it('rejects blob, credentials, IPs, wrong hosts, signed URLs and deceptive suffixes',()=>{
    expect(assertCatalogAudioUrl(url,['media.example.com']).hostname).toBe('media.example.com');
    for(const u of ['blob:https://media.example.com/file','http://media.example.com/a.mp3','https://user:password@media.example.com/a.mp3','https://127.0.0.1/a.mp3','https://[::1]/a.mp3','https://media.example.com.evil/a.mp3',url+'?X-Amz-Signature=abc',url+'?sig=abc',url+'?api_key=abc',url+'#fragment'])expect(()=>assertCatalogAudioUrl(u,['media.example.com'])).toThrow();
    for(const ip of ['0.0.0.0','127.0.0.2','10.1.2.3','172.20.1.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])expect(isPublicAudioAddress(ip)).toBe(false);
    expect(isPublicAudioAddress('8.8.8.8')).toBe(true);expect(isPublicAudioAddress('2606:4700:4700::1111')).toBe(true);
  });
  it('rejects DNS rebinding/private results even when another address is public',async()=>{
    const source=new CatalogAudioSource(async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]);
    await expect(source.validate(url,['media.example.com'])).rejects.toMatchObject({code:'AUDIO_DNS_UNSAFE'});
  });
  it('adds QUD chapter base once; clip offsets are already absolute, pads <=150ms',()=>{
    const row={ayah:1,source:'qud',coordinate:'source_ms' as const,source_offset_ms:null,words:[[1,0,1000,1500] as [number,number,number,number]]};
    const plan={chapterOffsetMs:60000,sourceFormat:'qud_release' as const,padMs:150};
    expect(toRenderTimeline([row],plan)).toMatchObject({sourceWindow:{fromMs:60850,toMs:61500},durationMs:650,ayahs:[{startMs:150,endMs:650}]});
    expect(toRenderTimeline([{...row,coordinate:'clip_ms',source_offset_ms:60000}],plan).sourceWindow).toEqual({fromMs:60850,toMs:61500});
    expect(()=>toRenderTimeline([row],{...plan,padMs:151})).toThrow('TIMELINE_PLAN_INVALID');
    expect(()=>toRenderTimeline([{...row,coordinate:'clip_ms'}],plan)).toThrow('TIMELINE_SOURCE_OFFSET_REQUIRED');
    expect(()=>toRenderTimeline([{...row,coordinate:'invalid' as 'source_ms'}],plan)).toThrow('TIMELINE_COORDINATE_UNSUPPORTED');
    expect(()=>toRenderTimeline([{...row,words:[[1,0,Number.MAX_SAFE_INTEGER-2,Number.MAX_SAFE_INTEGER]]}],plan)).toThrow('TIMELINE_WORD_INVALID');
  });
  it('v1 is never relaxed; v2 needs its approved codec-only evidence',()=>{
    expect(hasVerifiedCatalogOffset(base)).toBe(true);expect(hasVerifiedCatalogOffset({...base,offset_check_score:.949})).toBe(false);
    const v2={...base,verification_method:'v2',offset_check_score:.91,verification_details:{v2_acceptance:{cause:'codec_processing_only',decision:'accepted_for_data_pipeline_verification',minimum_VAD_agreement:.93,maximum_absolute_lag_ms:20,maximum_duration_difference_ms:25,sample_count:15,review_blockers:[]}}};
    expect(hasVerifiedCatalogOffset(v2)).toBe(true);expect(hasVerifiedCatalogOffset({...v2,verification_details:{v2_acceptance:{...v2.verification_details.v2_acceptance,cause:'unresolved'}}})).toBe(false);
    expect(hasVerifiedCatalogOffset({...v2,offset_verified:0})).toBe(false);
  });
  it('never substitutes another recitation, even for the same reciter',async()=>{
    const f=fixture();await expect(f.resolver.resolveAudioPlan({recitationId:'recitation',surah:1,from:1,to:2})).rejects.toMatchObject({code:'AUDIO_UNAVAILABLE',details:{suggested_recitations:[{slug:'another-recording-same-reader'}]}});
    expect(f.check.mock.calls.map(c=>c[0])).toEqual([url]);expect(f.execute).not.toHaveBeenCalled();
  });
  it('ignores wrong-recitation alternatives, and audits the same-recording alternative',async()=>{
    const alt={id:'alternate',recitation_id:'recitation',surah:1,url:'https://media.example.com/mirror/chapter.mp3',approved_by:'reviewer',recording_sha256:hash,identity_evidence:{primaryUrl:url,primarySha256:hash,alternateSha256:hash,method:'decoded_audio_sha256'}};
    const bad=fixture([{...alt,recitation_id:'other'}]);await expect(bad.resolver.resolveAudioPlan({recitationId:'recitation',surah:1,from:1,to:1})).rejects.toMatchObject({code:'AUDIO_UNAVAILABLE'});expect(bad.check).toHaveBeenCalledTimes(1);
    const good=fixture([alt]);expect(await good.resolver.resolveAudioPlan({recitationId:'recitation',surah:1,from:1,to:2})).toMatchObject({recitationId:'recitation',coordinate:'source_ms',fallbackUsed:true,alternateSourceId:'alternate',parts:[{url:alt.url,sliceFromMs:850,sliceToMs:2500}]});
    expect(good.identity).toHaveBeenCalledWith(alt.url,['media.example.com'],hash);expect(good.execute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'),expect.any(Array));
  });
  it('primary plan uses exact first-word crop without an alternate or audit write',async()=>{
    const f=fixture([],true);expect(await f.resolver.resolveAudioPlan({recitationId:'recitation',surah:1,from:2,to:2,padMs:50})).toMatchObject({fallbackUsed:false,parts:[{url,sliceFromMs:1950,sliceToMs:2500}]});expect(f.execute).not.toHaveBeenCalled();
    await expect(f.resolver.resolveAudioPlan({recitationId:'recitation',surah:1,from:1,to:3})).rejects.toMatchObject({code:'RANGE_NOT_AVAILABLE'});
  });
});
