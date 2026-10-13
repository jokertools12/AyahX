const requireProof=(condition,code)=>{if(!condition)throw new Error(code);};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);

/** This proves only that captions are inapplicable to the marked silent CI
 * artifact. It never certifies Quran, timing, audio, or render quality. */
export function assertAdminVisualNoAudioProof(proof){
 requireProof(proof?.ruleId==='video-caption'&&proof.resolved===true&&proof.reason==='NO_AUDIO_TRACK_IS_NOT_APPLICABLE','ADMIN_VISUAL_NO_AUDIO_PROOF_REQUIRED');
 requireProof(Array.isArray(proof.target)&&proof.target.length===1&&typeof proof.target[0]==='string'&&proof.target[0].length>0,'ADMIN_VISUAL_NO_AUDIO_EXACT_TARGET_REQUIRED');
 requireProof(proof.fixtureTag==='CI_VISUAL_ONLY_SYNTHETIC_BLACK'&&proof.actual_quran_render===false&&proof.human_acceptance===false,'ADMIN_VISUAL_NO_AUDIO_CI_SCOPE_REQUIRED');
 const media=proof.media;
 requireProof(uuid(media?.jobId)&&media.method==='AUTHENTICATED_FULL_MEDIA_GET'&&media.status===200&&media.contentType==='video/mp4','ADMIN_VISUAL_NO_AUDIO_MEDIA_REQUIRED');
 let url;try{url=new URL(media.currentSrc);}catch{throw new Error('ADMIN_VISUAL_NO_AUDIO_SOURCE_REQUIRED');}
 requireProof(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='3005'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname===`/api/admin/render-lab/jobs/${media.jobId}/media`&&media.responseUrl===media.currentSrc,'ADMIN_VISUAL_NO_AUDIO_SOURCE_REQUIRED');
 requireProof(proof.before?.tag==='VIDEO'&&proof.before.currentSrc===media.currentSrc&&proof.before.connected===true&&proof.before.inActiveScope===true&&proof.after?.tag==='VIDEO'&&proof.after.currentSrc===media.currentSrc&&proof.after.connected===true&&proof.after.inActiveScope===true,'ADMIN_VISUAL_NO_AUDIO_SOURCE_CHANGED');
 const artifact=proof.artifact,probe=proof.probe;
 requireProof(sha(artifact?.sha256)&&['seedSha256','localBeforeSha256','localAfterSha256','authenticatedGetSha256'].every(key=>artifact[key]===artifact.sha256)&&Number.isInteger(artifact.bytes)&&artifact.bytes>0&&artifact.bytes<=10*1024*1024&&media.bytes===artifact.bytes,'ADMIN_VISUAL_NO_AUDIO_ARTIFACT_MISMATCH');
 requireProof(probe?.source==='REAL_FFPROBE_LOCAL_ENCODED_ARTIFACT'&&probe.bytes===artifact.bytes&&Number.isFinite(probe.durationSeconds)&&probe.durationSeconds>0&&probe.durationSeconds<=2&&Array.isArray(probe.streams)&&probe.streams.length===1&&probe.streams[0].codec_type==='video'&&probe.streams[0].width===320&&probe.streams[0].height===180,'ADMIN_VISUAL_NO_AUDIO_PROBE_REQUIRED');
}
