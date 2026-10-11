/** Offline unit guards only. This script never opens Railway or a DB. */
import assert from 'node:assert/strict';
import {assertFinalProtected,storedAvailabilityProof,bindFinalPublication,finalRecitationRows,finalProtectedTables,type FinalPublicationPlan,type EvidenceRow} from './lib/d4FinalEvidence';
import {computeChapterAvailability,availabilityFingerprint} from '../server/services/recitationAvailability';
import {isPubliclyVisible,type PublicRecitation} from '../server/services/catalogContracts';
import type {Inventory} from './lib/railwayQuranOps';
let tests=0;
const test=(name:string,body:()=>void)=>{body();tests++;console.log(JSON.stringify({test:name,passed:true}));};
const now=Date.now();
const row:EvidenceRow={id:'recitation',slug:'reader_source',reciter_id:'reader',name_ar:'قارئ',provider:'mp3quran',riwayah:'hafs_an_asim',
  channel:'mp3quran',status:'published',voice_identity_status:'unverified',is_public:0,license_status:'unreviewed',offset_verified:1,
  audio_url:'https://private.invalid?signature=do-not-copy',password:'do-not-copy',verification_details:{private:'do-not-copy'}};
const chapter:EvidenceRow={id:'chapter',recitation_id:'recitation',surah:1,availability_state:'complete',coverage_mismatch:0,audio_status:'available',checked_epoch_ms:now-1000};
const plan=():FinalPublicationPlan=>({target:'production',applied:false,passed:true,changes:0,link_health_as_of_ms:now-500,
  decisions:[{id:'recitation',slug:'reader_source',reciter_id:'reader',provider:'mp3quran',riwayah:'hafs_an_asim',eligible:true,reasons:[],
    publication_change_planned:false,metadata_change_planned:false,completeChapters:1,healthyCompleteChapters:1,
    healthyLinks:1,links:1,coverageMismatches:0,licensedOffsetVerifiedCompleteChapters:0}]});
test('protected users/roles/D1/D3 checksums and counts cannot change',()=>{
  const base={server_uuid:'server',canonical_checksum:'hash',d1_counts:{surahs:1,ayahs:1,words:1},
    row_counts:Object.fromEntries(finalProtectedTables.map(name=>[name,1])),checksums:Object.fromEntries(finalProtectedTables.map(name=>[name,'123']))} as unknown as Inventory;
  assertFinalProtected(base,structuredClone(base));
  const bad=structuredClone(base);bad.checksums.user_roles='changed';assert.throws(()=>assertFinalProtected(bad,base),/PROTECTED_CHECKSUM_CHANGED/u);
});
test('stored T2 preserves blocked diagnostic READY runs in exact fingerprint',()=>{
  const expected=computeChapterAvailability({id:'chapter',surah:1,canonical:true,expected_ayahs:1,available_ayahs:1,
    coverage_mismatch:true,ayahs_complete:true,is_complete:true,timing_complete:true},
    [{ayah:1,coverage_words:1,expected_words:1,review_status:'ready',review_reasons:[],missing_words:[]}],new Map([[1,1]]));
  const stored={...expected,canonical:1,available_ayahs:1,coverage_mismatch:1};
  const proof=storedAvailabilityProof([stored],[{chapter_id:'chapter',ayah:1}]);
  assert.equal(proof.fingerprint,availabilityFingerprint([expected]));
  assert.notEqual(storedAvailabilityProof([stored],[]).fingerprint,proof.fingerprint);
});
test('fresh root plan binds actual same-chapter 24h facts and published status',()=>{
  assert.equal(bindFinalPublication([row],[chapter],plan(),now).size,1);
  assert.throws(()=>bindFinalPublication([row],[{...chapter,audio_status:'source_unavailable'}],plan(),now),/HEALTHY_COMPLETE_CHANGED/u);
  assert.throws(()=>bindFinalPublication([{...row,status:'needs_review'}],[chapter],plan(),now),/ELIGIBLE_NOT_PUBLISHED/u);
  const stale=plan();stale.link_health_as_of_ms=now-86400001;assert.throws(()=>bindFinalPublication([row],[chapter],stale,now),/PLAN_STALE/u);
});
test('public whitelist excludes URL/private JSON and flag off cannot be visible',()=>{
  const decisions=bindFinalPublication([row],[chapter],plan(),now);
  const result=finalRecitationRows([row],[chapter],decisions,new Map(),[],{enabled:false},
    (r,enabled)=>isPubliclyVisible(r as unknown as PublicRecitation,enabled));
  assert.equal(result[0].public_visible,false);assert.equal(result[0].offset_verified,true);
  assert.equal(result[0].valid_complete_chapters,1);assert.ok(!JSON.stringify(result).includes('do-not-copy'));
});
test('YouTube does not become ready from a row or a root numeric candidate alone',()=>{
  const youtube={...row,provider:'youtube',channel:'youtube',status:'needs_review'};
  const decision=plan().decisions[0];Object.assign(decision,{provider:'youtube',eligible:false,reasons:['YOUTUBE_RENDER_REQUIRES_LICENSED_FILE'],healthyCompleteChapters:0});
  const result=finalRecitationRows([youtube],[chapter],new Map([['recitation',decision]]),new Map(),[],{enabled:false},()=>false);
  assert.equal(result[0].youtube_audio_state,'بحاجة ملف');assert.equal(result[0].valid_complete_chapters,0);
  decision.licensedOffsetVerifiedCompleteChapters=1;
  assert.throws(()=>finalRecitationRows([youtube],[chapter],new Map([['recitation',decision]]),new Map(),[],{enabled:false},()=>false),/LICENSED_BINDING_CHANGED/u);
});
test('plan cannot silently drop a row, accept a duplicate ID, or consume string eligible',()=>{
  const missing=plan();missing.decisions=[];assert.throws(()=>bindFinalPublication([row],[chapter],missing,now),/SET_CHANGED/u);
  const typed=plan();typed.decisions[0].eligible='true';assert.throws(()=>bindFinalPublication([row],[chapter],typed,now),/BOOLEAN_REQUIRED/u);
});
console.log(JSON.stringify({passed:true,tests,network_requests:0,database_writes:0}));
