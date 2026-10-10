/** Offline supplement: no DB, provider requests, media extraction or mutation of original evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildYoutubeVoiceMetadataSupplement, readYoutubeNameCheckpoint, type YoutubeVoiceName, type YoutubeVoiceLink } from './lib/d4YoutubeVoiceMetadata';
const option = (key: string): string => { const index = process.argv.indexOf(key); assert.ok(index >= 0 && process.argv[index + 1], 'YOUTUBE_V1_REQUIRED_OPTION'); return process.argv[index + 1]; };
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const voiceBytes = readFileSync(option('--voice-report')), planBytes = readFileSync(option('--production-plan')), checkpointBytes = readFileSync(option('--checkpoint')), linkBytes = readFileSync(option('--link-report'));
const voice = JSON.parse(voiceBytes.toString('utf8')), plan = JSON.parse(planBytes.toString('utf8')), links = JSON.parse(linkBytes.toString('utf8'));
assert.equal(plan.checkpoint_sha256, hash(checkpointBytes), 'YOUTUBE_V1_CHECKPOINT_NOT_APPROVED_PLAN'); assert.equal(plan.complete, true);
const metadata = readYoutubeNameCheckpoint(checkpointBytes.toString('utf8'), plan.input_sha256);
const names = Object.values(voice.results).filter(row => (row as YoutubeVoiceName).provider === 'youtube') as YoutubeVoiceName[];
const result = buildYoutubeVoiceMetadataSupplement(names, links.last_checks as YoutubeVoiceLink[], metadata);
assert.equal(result.counts.recitations, plan.recitations, 'YOUTUBE_V1_RECITATION_COUNT_CHANGED');
assert.equal(result.counts.chapter_links, plan.chapter_links, 'YOUTUBE_V1_CHAPTER_COUNT_CHANGED');
assert.equal(result.counts.unique_measured_videos, plan.unique_videos, 'YOUTUBE_V1_VIDEO_COUNT_CHANGED');
for (const row of result.results) {
  const original = plan.recitation_results.find((record: { slug: string }) => record.slug === row.slug);
  assert.ok(original, 'YOUTUBE_V1_RECITATION_PLAN_MISSING'); assert.equal(original.chapter_links, row.chapter_links); assert.equal(original.unique_videos, row.unique_videos);
}
const report = { checked_at: new Date().toISOString(), update_reason: 'The original V1 used opaque YouTube folder/channel evidence; completed actual oEmbed checkpoint now supplies measured titles and channels, without new audio evidence.',
  input_sha256: { original_voice_auto_verification: hash(voiceBytes), production_metadata_plan: hash(planBytes), youtube_metadata_checkpoint: hash(checkpointBytes), youtube_metadata_manifest: plan.input_sha256, chapter_mapping_link_report: hash(linkBytes) }, ...result };
const cell = (value: string): string => value.replace(/[\r\n]/gu, ' ').replace(/\|/gu, '\\|').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const text = [ '# D4 K4 — مكمل V1 من oEmbed الفعلي', '',
  `في ${report.checked_at} رُبطت ${result.counts.recitations} تلاوات و${result.counts.chapter_links} فصول بـ${result.counts.unique_measured_videos} فيديو فريد في checkpoint المقاس سابقًا. تحققنا من سلسلة hashes ومن مطابقتها لخطة metadata الحالية، ومن أعداد الفصول والفيديوهات لكل تلاوة. صفر طلبات YouTube جديدة وصفر صوت أو DB أو تعديل server/schema.`, '',
  `دليل voice-auto-verification الأصلي محفوظ ببصمة ${hash(voiceBytes)} ولم يتغير. المكمل يبدل وصف دليل القناة المجهول بدليل عناوين وقنوات oEmbed الفعلية، ولا يبدل قرار الهوية: جميع ${result.counts.identity_unverified} تلاوات unverified، وV1.passed=false لأن audio fingerprints غير متاحة، وV2.passed=false لغياب دليل محاذاة صوتي جديد. تشابه الاسم والقناة ليس إذنًا أو هوية صوتية أو حقوقًا.`, '',
  'المطابقة حتمية فقط: في العربية NFKD وإزالة العلامات والتطويل وتوحيد أشكال الألف/ى/ة ثم البحث عن اسم القارئ المرجعي كاملًا بعد إزالة الفراغات؛ المقصود أسماء metadata فقط وليس النص القرآني. في الإنجليزية نطبع reciter_id المرجعي بالحروف الصغيرة وفواصل الكلمات ونطلب تسلسل الاسم كاملًا بحدود كلمات. لا AI أو fuzzy matching أو ترجمة صوتية أو aliases مخترعة، ولا تطابق اسم أول منفرد. غياب الاسم عن عنوان سورة قصير ليس إثبات قارئ مختلف، ووجود اسم قارئ آخر يسجل كملاحظة metadata فقط دون حكم fingerprint.', '',
  '| التلاوة | فصول | فيديوهات | مطابق اسم من عنوان/قناة | العنوان | القناة | القنوات المقاسة | الهوية |', '|---|---:|---:|---:|---:|---:|---|---|',
  ...result.results.map(row => `| ${row.slug} | ${row.chapter_links} | ${row.unique_videos} | ${row.matched_videos} | ${row.title_match_videos} | ${row.channel_match_videos} | ${row.channels.map(cell).join(' ؛ ')} | unverified |`), '',
  'الـJSON المرافق يتضمن كل video_id وعنوانه وقناته ووقت/http قياسه، وخريطة السور المرتبطة به، ونتائج التطابق وملاحظات الأسماء الأخرى. لا media URL أو HTML أو thumbnails أو audio أو مسارات خاصة أو credentials. cross_reader_content_conflict=null/not_evaluated لأن البيانات الصوتية غائبة؛ لم يُدّعَ أن بصمات الصوت فُحصت أو أن تعارضًا صوتيًا قد نُفي.', '',
  'القرار البشري يبقى في human_review_items عند الجذر؛ V2/الملف المرخص والحقوق والتحقق الصوتي لا تُستبدل بنتيجة oEmbed. لم يتغير confirmed أو offset أو licensing أو publication أو القالب أو الواجهة أو الريندر. يُحفظ المكمل append-only: يرفض السكربت الكتابة فوق أي ملف نتيجة قائم.', '',
].join('\n');
writeFileSync(option('--out-json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
writeFileSync(option('--out-md'), text, { flag: 'wx' });
assert.equal(hash(readFileSync(option('--voice-report'))), hash(voiceBytes), 'YOUTUBE_V1_ORIGINAL_ARTIFACT_CHANGED');
console.log(JSON.stringify(report.counts));
