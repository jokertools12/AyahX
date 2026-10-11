/** Offline metadata and retained-file audit only. No network/DB/services/deletion. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { buildD4DurationAudit, type DurationMeasurement, type DurationEndpoint, type DurationLink, type RetainedDurationCheck } from './lib/d4DurationAudit';
const option = (key: string): string => { const index = process.argv.indexOf(key); assert.ok(index >= 0 && process.argv[index + 1], 'DURATION_REQUIRED_OPTION'); return process.argv[index + 1]; };
const hash = (value: Buffer): string => createHash('sha256').update(value).digest('hex');
const voiceBytes = readFileSync(option('--voice-report')), endpointBytes = readFileSync(option('--endpoints')), linkBytes = readFileSync(option('--link-report')), diagnosisBytes = readFileSync(option('--diagnosis'));
const voice = JSON.parse(voiceBytes.toString('utf8')), endpoints = JSON.parse(endpointBytes.toString('utf8')), links = JSON.parse(linkBytes.toString('utf8')), diagnosis = JSON.parse(diagnosisBytes.toString('utf8'));
const previousBytes = readFileSync(option('--previous-endpoints')), previous = JSON.parse(previousBytes.toString('utf8'));
assert.equal(previous.source_artifact_sha256, hash(voiceBytes), 'DURATION_PREVIOUS_ENDPOINT_ARTIFACT_MISMATCH');
assert.ok(Array.isArray(previous.measurements));
assert.equal(endpoints.source_artifact_sha256, hash(voiceBytes), 'DURATION_ENDPOINT_VOICE_ARTIFACT_MISMATCH');
assert.equal(endpoints.catalog_chapters, links.total, 'DURATION_CATALOG_INVENTORY_CHANGED');
const measurements = voice.duration_quality_comparison.measurements as DurationMeasurement[];
assert.ok(Array.isArray(measurements)); assert.ok(Array.isArray(endpoints.measurements)); assert.ok(Array.isArray(links.last_checks));
const checks: RetainedDurationCheck[] = [];
for (const measurement of measurements) {
  assert.match(measurement.slug, /^[a-z0-9_-]+$/u); assert.ok(Number.isSafeInteger(measurement.surah) && measurement.surah > 0 && measurement.surah <= 114);
  const scratch = diagnosis.results[measurement.slug]?.scratch_dir;
  assert.ok(typeof scratch === 'string' && isAbsolute(scratch), 'DURATION_RETAINED_SOURCE_LOCATOR_MISSING');
  // Only the complete retained original; clip-* and HF payloads are never selected.
  const file = join(scratch, String(measurement.surah) + '.audio');
  let size: number;
  try { size = (await stat(file)).size; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') { checks.push({ slug: measurement.slug, surah: measurement.surah, status: 'missing', sizeBytes: null, sourceSha256: null }); continue; } throw new Error('DURATION_RETAINED_SOURCE_STAT_FAILED'); }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  const actualSha = digest.digest('hex');
  checks.push({ slug: measurement.slug, surah: measurement.surah, status: actualSha === measurement.actual_source_sha256 && size === measurement.format_size_bytes ? 'verified' : 'hash_or_size_mismatch', sourceSha256: actualSha, sizeBytes: size });
}
const report = { checked_at: new Date().toISOString(), inputs: { voice_report_sha256: hash(voiceBytes), endpoint_export_sha256: hash(endpointBytes), previous_endpoint_export_sha256: hash(previousBytes), link_report_sha256: hash(linkBytes), diagnosis_sha256: hash(diagnosisBytes) }, previous_diagnostic: { retained: true, measurements: previous.measurements.length, convertible: (previous.measurements as DurationEndpoint[]).filter(row => row.source_end_ms !== null).length, chapter_offset_unavailable: (previous.measurements as DurationEndpoint[]).filter(row => row.reason === 'CHAPTER_OFFSET_UNAVAILABLE').length, replacement_reason: 'Standalone chapter resource origin supports expected endpoint metadata comparison only; no offset/alignment verification is inferred.' }, ...buildD4DurationAudit(measurements, endpoints.measurements as DurationEndpoint[], links.last_checks as DurationLink[], checks) };
writeFileSync(option('--out-json'), JSON.stringify(report, null, 2) + '\n');
const counts = report.counts;
const prose = [ '# D4 — تدقيق المدة من الأدلة المحفوظة', '',
  `التدقيق في ${report.checked_at}: ${counts.verified_full_source_durations} مدة ملف فصل كامل مثبتة من ${counts.retained_measurements} عينة محفوظة، موزعة على ${report.per_recitation.filter(row => row.retained_full_source_durations > 0).length} تلاوة. البصمة والحجم أعيد فحصهما من الملفات الأصلية المحفوظة، وقياسات ffprobe هي القياسات المؤرخة في voice-identity-report. لم يُنزّل صوت ولم يُشغّل خدمة أو يُكتب DB أو يُحذف ملف.`, '',
  `مقارنة آخر كلمة مخزنة متاحة لـ${counts.endpoint_comparisons} فصلًا فقط؛ ${counts.warnings_over_5_percent} تحذيرات تتجاوز 5% حسب abs(duration-end)/end بالقيم الخام. انتهى تحويل التوقيت لدى الجذر عبر toRenderTimeline وحده. بداية مورد الفصل المستقل مرجع حسابي لصفر الملف في هذا الفحص فقط؛ هذا لا يثبت صحة الـoffset أو المحاذاة، ولا ينشر التلاوة. فقدان mapping لا يُعالج باختلاق index.`, '',
  `الجرد ${counts.catalog_chapters} فصلًا في ${counts.recitations} تلاوة؛ ${counts.full_source_duration_unavailable} مدة فصل كامل غير متاحة. HEAD/Range يثبت وصول الرابط فقط، ولا يعطي مدة من Content-Length؛ لا حساب CBR ولا تعميم VBR ولا استعارة مدة مقطع آية/HF. الجدول التالي يجعل البقية غير المتحققة صريحة.`, '',
  'مصادر الدليل: voice-identity-report.json.duration_quality_comparison.measurements؛ link-scan-final.json.last_checks؛ تصدير الجذر الخاص source_end_ms وendpoint_scope؛ d3-audio-failure-diagnosis-v2.json لتحديد الملفات الكاملة المحفوظة. بصمات الملفات المدخلة في JSON المرافق؛ لا صوت أو URLs أو مسارات scratch في التقرير العام.', '',
  'أسباب تعذر المقارنة: `' + JSON.stringify(counts.endpoint_unavailable_reasons) + '`.', '',
  `التشخيص الأول محفوظ ببصمة ${hash(previousBytes)}: ${report.previous_diagnostic.convertible} تحويلًا متاحًا و${report.previous_diagnostic.chapter_offset_unavailable} حالة CHAPTER_OFFSET_UNAVAILABLE. التصدير اللاحق استخدم مرجع بداية مورد الفصل المستقل المشروط بتطابق URL مع المصدر الكامل غير YouTube، لغرض مقارنة النهاية المتوقع فقط. لم يُمسح التشخيص الأول ولم تتحول أي حالة offset فاشلة إلى نجاح.`, '',
  '| تحذير: التلاوة | السورة | مدة المصدر ms | نهاية المخزّن ms | الفرق ms | النسبة % | offset_verified في الجرد |', '|---|---:|---:|---:|---:|---:|---|',
  ...report.measurements.filter(row => row.warning_over_5_percent).map(row => `| ${row.recitation} | ${row.surah} | ${row.verified_full_source_duration_ms} | ${row.last_stored_word_source_end_ms} | ${row.delta_ms} | ${(row.relative_duration_difference! * 100).toFixed(3)} | ${row.offset_verified} |`), '',
  '| التلاوة | فصول الجرد | مدة كاملة | مقارنة النهاية | تحذير >5% | نهاية غير متاحة بعد قياس المدة | مدة كاملة غير متاحة |', '|---|---:|---:|---:|---:|---:|---:|',
  ...report.per_recitation.map(row => `| ${row.recitation} | ${row.catalog_chapters} | ${row.retained_full_source_durations} | ${row.endpoint_comparisons} | ${row.warnings_over_5_percent} | ${row.measured_but_endpoint_unavailable} | ${row.full_source_duration_unavailable} |`), '',
  'مخاطر القراءة: المقدمة والبسملة والصمت والخاتمة واختلاف التسجيل أو نقص الكلمات قد تفسر فرق المدة؛ التحذير يستلزم مراجعة ولا يمنح قبول offset/هوية/توقيت. الصفوف وتفاصيل ms متاحة في JSON المرافق. جميع الـoffset التي لم تثبت تبقى غير مثبتة. المرحلة D5 خارج هذه المهمة.', '',
].join('\n');
writeFileSync(option('--out-md'), prose);
console.log(JSON.stringify({ ...counts, retained_hash_or_size_mismatches: checks.filter(row => row.status !== 'verified').length, network_requests: 0, db_writes: 0 }));
