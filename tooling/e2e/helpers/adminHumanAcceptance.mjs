import {resolve,relative,isAbsolute} from 'node:path';

export const humanTasks=Object.freeze([
 {id:'M1',budget:4,title:'تأكيد صوت قارئ'}, {id:'M2',budget:4,title:'قرار ترخيص مزوّد'},
 {id:'M3',budget:3,title:'تعديل اسم تلاوة'}, {id:'M4',budget:3,title:'إخفاء وإظهار قارئ'},
 {id:'M5',budget:2,title:'سبب عدم ظهور تلاوة'}, {id:'M6',budget:5,title:'بدء رفع ملف مرخّص'},
 {id:'M7',budget:10,title:'إضافة قارئ وتلاوة بنمط روابط',unit:'steps'},
 {id:'M8',budget:6,title:'إنشاء فيديو تجريبي ومشاهدته'}, {id:'M9',budget:2,title:'معرفة ما تبقّى'},
 {id:'M10',budget:3,title:'قراءة خطوات تجديد R2'}, {id:'M11',budget:4,title:'رؤية الكلمات الناقصة'},
 {id:'M12',budget:2,title:'فهم معاينة الظهور العام'},
]);

export function assertPrivatePath(path,cwd=process.cwd()){
 const result=resolve(path),location=relative(resolve(cwd),result);
 if(!isAbsolute(path)||!location.startsWith('..')&&!isAbsolute(location))throw new Error('PRIVATE_PATH_OUTSIDE_GIT_REQUIRED');
 return result;
}
export function validateHumanManifest(value,production=false){
 if(value?.version!==1||value.fixtureTag!=='BATCH5_HUMAN_QA')throw new Error('HUMAN_FIXTURE_VERSION_REQUIRED');
 const base=new URL(value.baseUrl);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('HUMAN_BASE_ORIGIN_REQUIRED');
 if(production){
  if(value.mode!=='production-read-only'||base.protocol!=='https:'||!value.tagAttestation?.productionTargetsReadOnly)throw new Error('PRODUCTION_READ_ONLY_ATTESTATION_REQUIRED');
 }else if(value.mode!=='local-mutations'||base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||!value.tagAttestation?.localTargetsAreDisposable)throw new Error('LOCAL_DISPOSABLE_TARGETS_REQUIRED');
 assertPrivatePath(value.authFile);
 const targets=value.targets;
 for(const key of ['voice','provider','label','reader','hidden','youtube','wizard','render','nearComplete'])if(!targets?.[key])throw new Error('MISSING_HUMAN_TARGET:'+key);
 const ids=['voice.recitationId','voice.reviewId','provider.providerId','provider.reviewId','label.recitationId','reader.id','hidden.recitationId','youtube.recitationId','render.reciterId','render.recitationId','nearComplete.recitationId'];
 for(const key of ids){const [group,field]=key.split('.');if(typeof targets[group][field]!=='string'||!/^[a-zA-Z0-9_-]+$/u.test(targets[group][field]))throw new Error('INVALID_HUMAN_TARGET_IDENTIFIER:'+key);}
 if(!production){
  if(!targets.youtube.rightsReviewId||!targets.youtube.rightsEvidenceRef||!/^[a-f0-9]{64}$/u.test(targets.youtube.sha256))throw new Error('LOCAL_LICENSED_AUDIO_PROOF_REQUIRED');
  assertPrivatePath(targets.youtube.audioFile);
  if(!targets.wizard.slug||!targets.wizard.riwayahCode||!targets.wizard.pattern||!targets.wizard.providerId)throw new Error('LOCAL_WIZARD_INPUT_REQUIRED');
 }
 for(const origin of [...value.allowedReadOrigins??[],...value.allowedUploadOrigins??[]]){const parsed=new URL(origin);if(parsed.origin!==origin||parsed.protocol!=='https:')throw new Error('EXPLICIT_HTTPS_EXTERNAL_ORIGIN_REQUIRED');}
 return{...value,baseUrl:base.origin};
}

/** Pointer clicks and keyboard activations count equally. Tab/type are reported. */
export class HumanTaskBudget{
 constructor(task,mode){this.task=task;this.mode=mode;this.started=performance.now();this.clicks=0;this.pointerClicks=0;this.keyboardActivations=0;this.tabPresses=0;this.fieldsTyped=0;this.selections=0;this.steps=0;this.actions=[];}
 activate(label,kind='pointer'){
  if(!/^[a-z0-9_-]+$/u.test(label))throw new Error('SANITIZED_ACTION_LABEL_REQUIRED');
  this.clicks++;if(kind==='pointer')this.pointerClicks++;else this.keyboardActivations++;
  this.actions.push({label,kind});this.enforce();
 }
 step(label){this.steps++;this.actions.push({label,kind:'wizard-step'});this.enforce();}
 enforce(){if((this.task.unit==='steps'?this.steps:this.clicks)>this.task.budget)throw new Error('HUMAN_BUDGET_EXCEEDED');}
 result(extra={}){return{id:this.task.id,title:this.task.title,mode:this.mode,budget:this.task.budget,unit:this.task.unit??'clicks',clicks:this.clicks,pointerClicks:this.pointerClicks,keyboardActivations:this.keyboardActivations,tabPresses:this.tabPresses,fieldsTyped:this.fieldsTyped,selections:this.selections,steps:this.steps,elapsedMs:Math.round(performance.now()-this.started),actions:this.actions,...extra};}
}

/** The only allowed writes after login are those performed through tagged UI. */
export function allowedHumanApplicationWrite(method,path,manifest,body){
 if(method==='POST'&&['/api/admin/auth/login','/api/admin/auth/logout'].includes(path))return true;
 if(manifest.mode==='production-read-only')return false;
 const t=manifest.targets;
 const post=new Set([
  ...[t.voice.reviewId,t.provider.reviewId,t.youtube.rightsReviewId].filter(Boolean).map(id=>`/api/admin/reviews/${id}/decision`),
  `/api/admin/labels/${t.label.recitationId}/approve`,
  `/api/admin/catalog/reciters/${t.reader.id}/visibility`,
  '/api/admin/reciter-wizard/validate','/api/admin/reciter-wizard','/api/admin/render-lab/jobs',
 ]);
 if(method==='POST'&&post.has(path))return true;
 // Upload route is scoped to the disposable recording; lifecycle capabilities
 // are registered from real prepare responses by the browser harness itself.
 return method==='POST'&&path==='/api/admin/storage/uploads'&&body?.recitationId===t.youtube.recitationId&&body?.rightsRef===t.youtube.rightsReviewId&&body?.sha256===t.youtube.sha256&&body?.surah===t.youtube.surah;
}
