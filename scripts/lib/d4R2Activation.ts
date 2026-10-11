import assert from 'node:assert/strict';
import { canonicalAuditJson } from '../../server/services/catalogAudit';
import { assertLicensedOffsetEvidence, type LicensedOffsetEvidence } from '../../server/services/licensedAudioVerification';
import { D4AuditSqlPlan, d4Literal, sha256 } from './d4AuditSqlPlan';
import type { Inventory } from './railwayQuranOps';

export type ActivationArtifact = { value: Record<string, unknown>; sha256: string };
export type ActivationArtifacts = Record<'acceptance' | 'logScan' | 'browser' | 'variables' | 'budget', ActivationArtifact>;
interface AcceptanceReport {
  finished_at: string; status: string; actual_r2: boolean; bucket: string; prefix: string; test_objects_deleted: boolean; cleanup_failure_codes: string[]; secret_scan: string;
  results: { multipart: { resume_from_persisted_checkpoint_fresh_client: boolean; bytes: number; parts: number }; read_range_sha: { full_sha256_matches: boolean; range_status: number; signed_ttl_seconds: number }; credential_scoping: object; immutable_object: string; rejections: object; audio_plan_render: { actual_ffmpeg: boolean; audio_and_video: boolean; kind: string }; abort_incomplete_upload: { list_parts_status: number }; lifecycle_day_one: { status: string; abort_after_seconds: number }; actual_verification: Array<{ offset: LicensedOffsetEvidence; sha256: string; surah: number }>; browser_cors: { status: string; evidence_sha256: string } };
}
interface VariableProof { finished_at: string; passed: boolean; secrets_logged: boolean; results: Array<{ environment: string; service: string; readback_matched: boolean; writer_granted: boolean; variable_names: string[] }> }
interface BrowserProof { checked_at: string; actual_r2: boolean; bucket: string; browser: string; allowed_origin: string; denied_origin: string; checks: Record<string, unknown> }
export interface AdapterSetting { value_text: 'url_reference' | 'r2'; is_secret: number; category: string; updated_at: string }
const fresh = (date: unknown, now: number, maxAge = 24 * 3600 * 1000): void => { const time = typeof date === 'string' ? Date.parse(date) : NaN; assert.ok(Number.isFinite(time) && now >= time && now - time <= maxAge, 'R2_ACTIVATION_EVIDENCE_STALE'); };
export function verifyActivationArtifacts(a: ActivationArtifacts, now = Date.now()): Record<string, string> {
  for (const x of Object.values(a)) assert.match(x.sha256, /^[a-f0-9]{64}$/u, 'R2_ACTIVATION_ARTIFACT_SHA_REQUIRED');
  const r = a.acceptance.value as unknown as AcceptanceReport, s = a.logScan.value, b = a.browser.value as unknown as BrowserProof, v = a.variables.value as unknown as VariableProof, budget = a.budget.value;
  fresh(r.finished_at, now); fresh(s.checked_at, now); fresh(b.checked_at, now); fresh(v.finished_at, now); fresh(budget.checked_at, now, 30 * 60 * 1000);
  assert.equal(r.status, 'PASSED_STORAGE_ACCEPTANCE_1_TO_7'); assert.equal(r.actual_r2, true); assert.equal(r.bucket, 'ayahx-audio-staging'); assert.match(r.prefix, /^test\/[a-f0-9-]{36}\/$/u); assert.equal(r.test_objects_deleted, true); assert.deepEqual(r.cleanup_failure_codes, []); assert.equal(r.secret_scan, 'PASSED_REPORT_AND_REDACTED_ERROR_FIELDS');
  assert.equal(r.results?.multipart?.resume_from_persisted_checkpoint_fresh_client, true); assert.ok(r.results.multipart.bytes >= 50 * 1024 * 1024 && r.results.multipart.parts >= 2);
  assert.equal(r.results?.read_range_sha?.full_sha256_matches, true); assert.equal(r.results.read_range_sha.range_status, 206); assert.ok(r.results.read_range_sha.signed_ttl_seconds <= 900);
  assert.deepEqual(r.results?.credential_scoping, { read_only_put: 403, read_only_delete: 403, writer_existing_production_bucket_list: 403, production_mutations: 0 });
  assert.equal(r.results?.immutable_object, 'STORAGE_OBJECT_IMMUTABLE');
  assert.deepEqual(r.results?.rejections, { above_1gb: 'AUDIO_OBJECT_SIZE_LIMIT', truncated: 'AUDIO_UPLOAD_TRUNCATED', wrong_sha: 'AUDIO_SHA256_MISMATCH', invalid_magic: 'AUDIO_MAGIC_INVALID', video_stream: 'AUDIO_STREAMS_INVALID' });
  assert.equal(r.results?.audio_plan_render?.actual_ffmpeg, true); assert.equal(r.results.audio_plan_render.audio_and_video, true); assert.equal(r.results.audio_plan_render.kind, 'licensed_file');
  assert.equal(r.results?.abort_incomplete_upload?.list_parts_status, 404); assert.equal(r.results?.lifecycle_day_one?.status, 'PASSED'); assert.equal(r.results.lifecycle_day_one.abort_after_seconds, 86400);
  assert.ok(Array.isArray(r.results?.actual_verification) && r.results.actual_verification.length === 3);
  for (const row of r.results.actual_verification) assertLicensedOffsetEvidence(row.offset, 'owned-test-fixture', row.sha256, row.surah);
  assert.equal(s.status, 'PASSED_STORAGE_ACCEPTANCE_1_TO_7_AND_LOG_SECRET_SCAN'); assert.equal(s.child_exit_code, 0); assert.equal(s.secret_scan_passed, true); assert.equal(s.logs_retained, false);
  assert.equal(b.actual_r2, true); assert.equal(b.bucket, 'ayahx-audio-staging'); assert.equal(b.browser, 'chromium'); assert.equal(b.allowed_origin, 'https://ayahx-staging.up.railway.app'); assert.notEqual(b.denied_origin, b.allowed_origin);
  for (const key of ['allowed_put', 'allowed_get', 'disallowed_blocked']) assert.equal(b.checks?.[key], true); assert.equal(b.checks.range_status, 206);
  assert.equal(r.results?.browser_cors?.status, 'PASSED'); assert.equal(r.results.browser_cors.evidence_sha256, a.browser.sha256, 'R2_BROWSER_HASH_CHAIN_CHANGED');
  assert.equal(v.passed, true); assert.equal(v.secrets_logged, false); assert.ok(Array.isArray(v.results));
  const readNames = ['R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_BUCKET', 'R2_READ_ACCESS_KEY_ID', 'R2_READ_SECRET_ACCESS_KEY'];
  for (const service of ['AyahX', 'render-worker-skia', 'render-control']) {
    const rows = v.results.filter(x => x.environment === 'production' && x.service === service); assert.equal(rows.length, 1, 'R2_PRODUCTION_VARIABLES_SERVICE_REQUIRED'); const row = rows[0]; assert.equal(row.readback_matched, true); assert.equal(row.writer_granted, service === 'AyahX');
    assert.ok(readNames.every(k => row.variable_names.includes(k))); if (service === 'AyahX') assert.ok(['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].every(k => row.variable_names.includes(k))); else assert.ok(!row.variable_names.includes('R2_SECRET_ACCESS_KEY') && !row.variable_names.includes('R2_ACCESS_KEY_ID'), 'R2_WORKER_WRITER_CREDENTIALS_FORBIDDEN');
  }
  assert.equal(budget.hard_limit, 30); assert.ok(typeof budget.current_usage_dollars === 'number' && Number.isFinite(budget.current_usage_dollars) && budget.current_usage_dollars >= 0 && typeof budget.remaining_dollars === 'number' && Number.isFinite(budget.remaining_dollars) && Math.abs(budget.remaining_dollars - (30 - budget.current_usage_dollars)) < .000001 && budget.remaining_dollars >= 3, 'R2_WORKSPACE_BUDGET_STOP');
  return Object.fromEntries(Object.entries(a).map(([key, x]) => [key, x.sha256]));
}
export function planR2Activation(setting: AdapterSetting | null, auditSeed: string, artifactHashes: Record<string, string>) {
  if (setting) { assert.ok(['url_reference', 'r2'].includes(setting.value_text) && setting.is_secret === 0, 'R2_EXISTING_SETTING_UNEXPECTED'); assert.ok(typeof setting.category === 'string' && typeof setting.updated_at === 'string'); }
  const plan = new D4AuditSqlPlan(auditSeed), delta = setting ? 0 : 1;
  if (setting?.value_text !== 'r2') {
    if (!setting) plan.statements.push("INSERT INTO system_settings(key_name,value_text,is_secret,category) VALUES('storage_adapter','r2',0,'catalog');");
    else plan.statements.push(`UPDATE system_settings SET value_text='r2' WHERE key_name='storage_adapter' AND value_text='url_reference' AND is_secret=0 AND category=${d4Literal(setting.category)} AND CAST(UNIX_TIMESTAMP(updated_at) AS CHAR)=${d4Literal(setting.updated_at)};`);
    plan.statements.push('INSERT INTO ayahx_d4_data_guard VALUES(IF(ROW_COUNT()=1,1,0));');
    plan.append('settings.storage_adapter.activate', 'system_settings', 'storage_adapter', setting ? { value_text: setting.value_text, is_secret: false, category: setting.category } : null, { value_text: 'r2', is_secret: false, category: setting?.category ?? 'catalog', artifact_hashes: artifactHashes, scope: 'ADAPTER_ONLY_NO_PUBLIC_OR_HUMAN_STATE_CHANGES' });
  }
  return { ...plan.finish(), settings_row_delta: delta, changed: plan.mutations.length === 1 };
}
export function assertProtectedInventory(before: Inventory, after: Inventory, settingsDelta = 0): void {
  assert.equal(after.server_uuid, before.server_uuid, 'R2_DATABASE_IDENTITY_CHANGED'); assert.equal(after.mysql_version, '9.7.2'); assert.equal(after.canonical_checksum, before.canonical_checksum, 'R2_D1_CANONICAL_CHANGED'); assert.deepEqual(after.d1_counts, before.d1_counts);
  assert.deepEqual(after.tables.map(t => t.name).sort(), before.tables.map(t => t.name).sort(), 'R2_SCHEMA_CHANGED');
  for (const name of Object.keys(before.row_counts)) {
    if (name === 'audit_logs') continue;
    assert.equal(after.row_counts[name], before.row_counts[name] + (name === 'system_settings' ? settingsDelta : 0), 'R2_PROTECTED_COUNT_CHANGED:' + name);
    if (name === 'system_settings') continue;
    assert.ok(before.checksums[name] !== null && before.checksums[name] !== undefined, 'R2_PROTECTED_CHECKSUM_UNAVAILABLE:' + name); assert.equal(after.checksums[name], before.checksums[name], 'R2_PROTECTED_CHECKSUM_CHANGED:' + name);
  }
}
export function settingsRowsFingerprint(hashes: readonly string[]): string { return sha256(canonicalAuditJson(hashes)); }
export function protectedInventoryFingerprint(i: Inventory): string {
  const excluded = new Set(['system_settings', 'audit_logs']);
  return sha256(canonicalAuditJson({ server_uuid: i.server_uuid, canonical_checksum: i.canonical_checksum, d1_counts: i.d1_counts, tables: i.tables.map(t => t.name).sort(), counts: Object.fromEntries(Object.entries(i.row_counts).filter(([k]) => !excluded.has(k))), checksums: Object.fromEntries(Object.entries(i.checksums).filter(([k]) => !excluded.has(k))) }));
}
