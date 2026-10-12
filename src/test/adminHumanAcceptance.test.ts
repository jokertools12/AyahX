// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {humanTasks,HumanTaskBudget,allowedHumanApplicationWrite,validateHumanManifest,assertPrivatePath} from '../../tooling/e2e/helpers/adminHumanAcceptance.mjs';

const local=()=>({version:1,fixtureTag:'BATCH5_HUMAN_QA',mode:'local-mutations',baseUrl:'http://127.0.0.1:4188',authFile:join(tmpdir(),'ayahx-private-auth.json'),tagAttestation:{localTargetsAreDisposable:true},targets:{voice:{recitationId:'voice',reviewId:'voice-review'},provider:{providerId:'provider',reviewId:'provider-review'},label:{recitationId:'label'},reader:{id:'reader'},hidden:{recitationId:'hidden'},youtube:{recitationId:'youtube',rightsReviewId:'owned-rights-review',rightsEvidenceRef:'local-test',audioFile:join(tmpdir(),'001.mp3'),sha256:'a'.repeat(64),surah:1},wizard:{slug:'batch5-test',riwayahCode:'hafs',pattern:'https://example.test/{surah:03d}.mp3',providerId:'provider'},render:{reciterId:'render-reader',recitationId:'render-recording'},nearComplete:{recitationId:'near'}}});
describe('human admin task safety and click budgets',()=>{
 it('retains exactly M1-M12 budgets and treats wizard separately as steps',()=>{
  expect(humanTasks.map(task=>[task.id,task.budget])).toEqual([['M1',4],['M2',4],['M3',3],['M4',3],['M5',2],['M6',5],['M7',10],['M8',6],['M9',2],['M10',3],['M11',4],['M12',2]]);
  const budget=new HumanTaskBudget(humanTasks[0],'local-mutations');for(let i=0;i<4;i++)budget.activate('real-ui-action');expect(()=>budget.activate('fifth-action','keyboard')).toThrow('HUMAN_BUDGET_EXCEEDED');expect(budget.result().clicks).toBe(5);
  const wizard=new HumanTaskBudget(humanTasks[6],'local-mutations');for(let i=0;i<10;i++)wizard.step('phase');expect(()=>wizard.step('extra-phase')).toThrow('HUMAN_BUDGET_EXCEEDED');
 });
 it('rejects external mutation targets and requires explicit production read-only attestation',()=>{
  expect(validateHumanManifest(local()).baseUrl).toBe('http://127.0.0.1:4188');
  expect(()=>validateHumanManifest({...local(),baseUrl:'https://production.invalid'})).toThrow('LOCAL_DISPOSABLE_TARGETS_REQUIRED');
  expect(()=>validateHumanManifest({...local(),mode:'production-read-only',baseUrl:'https://production.invalid'},true)).toThrow('PRODUCTION_READ_ONLY_ATTESTATION_REQUIRED');
  expect(()=>validateHumanManifest({...local(),mode:'production-read-only',baseUrl:'https://production.invalid',tagAttestation:{productionTargetsReadOnly:true}},true)).not.toThrow();
 });
 it('requires files outside Git and a complete target manifest instead of skipping tests',()=>{
  expect(()=>assertPrivatePath(join(process.cwd(),'private-auth.json'))).toThrow('PRIVATE_PATH_OUTSIDE_GIT_REQUIRED');
  expect(()=>validateHumanManifest({...local(),targets:{}})).toThrow('MISSING_HUMAN_TARGET');
  expect(()=>validateHumanManifest({...local(),targets:{...local().targets,youtube:{...local().targets.youtube,sha256:'invalid'}}})).toThrow('LOCAL_LICENSED_AUDIO_PROOF_REQUIRED');
 });
 it('never admits any production decision, preference, upload, render or DDL request',()=>{
  const manifest={...local(),mode:'production-read-only'};
  for(const path of ['/api/admin/reviews/voice-review/decision','/api/admin/storage/uploads','/api/admin/render-lab/jobs','/api/admin/preferences','/api/admin/labels/label/approve'])expect(allowedHumanApplicationWrite('POST',path,manifest)).toBe(false);
  expect(allowedHumanApplicationWrite('POST','/api/admin/auth/login',manifest)).toBe(true);
 });
 it('scopes local decisions to designated review IDs and uploads to exact owned file',()=>{
  const manifest=local();expect(allowedHumanApplicationWrite('POST','/api/admin/reviews/voice-review/decision',manifest)).toBe(true);expect(allowedHumanApplicationWrite('POST','/api/admin/reviews/original-review/decision',manifest)).toBe(false);
  const body={recitationId:'youtube',rightsRef:'owned-rights-review',sha256:'a'.repeat(64),surah:1};
  expect(allowedHumanApplicationWrite('POST','/api/admin/storage/uploads',manifest,body)).toBe(true);
  for(const change of [{recitationId:'original'},{rightsRef:'original-review'},{surah:2},{sha256:'b'.repeat(64)}])expect(allowedHumanApplicationWrite('POST','/api/admin/storage/uploads',manifest,{...body,...change})).toBe(false);
  expect(allowedHumanApplicationWrite('DELETE','/api/admin/users/owner',manifest)).toBe(false);
 });
});
