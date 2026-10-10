/** Actual HTTPS/FFmpeg streams. No local audio file or upload. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { CatalogAudioSource } from '../server/services/catalogAudioSource';
const source=new CatalogAudioSource();const hosts=['server9.mp3quran.net','cdn.mp3quran.net'];
const primary='https://server9.mp3quran.net/hthfi/112.mp3';
const report:Record<string,unknown>={started_at:new Date().toISOString(),actual_https:true,actual_ffmpeg:true,audio_files_saved:0};
try{
  const checked=await source.checkLink(primary,hosts);report.primary=checked;assert.equal(checked.status,'available');assert.ok(checked.finalUrl);
  const proof=await source.verifySameRecording(primary,checked.finalUrl!,hosts);report.same_recording_proof=proof;assert.equal(proof.primarySha256,proof.alternateSha256);
  await assert.rejects(source.verifySameRecording(primary,'https://server9.mp3quran.net/hthfi/001.mp3',hosts),error=>error instanceof Error&&error.message==='ALTERNATE_RECORDING_MISMATCH');
  await assert.rejects(source.validate('https://server9.mp3quran.net/hthfi/112.mp3',['cdn.mp3quran.net']),error=>error instanceof Error&&error.message==='AUDIO_HOST_NOT_ALLOWED');
  report.different_chapter_rejected=true;report.unallowlisted_original_rejected=true;report.passed=true;
}catch(error){report.passed=false;report.failure=error instanceof Error?error.message:'UNKNOWN_FAILURE';throw error;}
finally{report.finished_at=new Date().toISOString();writeFileSync('docs/data/d4-t4-real-audio-source.json',JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,saved_audio_files:0}));
