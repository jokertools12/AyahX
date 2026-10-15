// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildRuntimePrivilegePlan, type RuntimeDatabaseService } from '../../server/db/runtimePrivilegePlan';
import { runtimeSchemaColumns } from '../../server/db/runtimeSchemaContract';

const tables = ['achievements', 'alignment_documents', 'alignment_review_events', 'catalog_audit_events', 'catalog_role_grants',
  'daily_cloud_render_usage', 'daily_render_engine_usage', 'daily_video_usage', 'favorite_performers', 'favorite_reciters', 'favorite_surahs',
  'mushaf_profiles', 'notifications', 'payment_requests', 'profiles', 'quran_data_sources', 'recitation_coverage', 'reciter_catalog',
  'reciter_recordings', 'render_engine_capacity', 'render_job_audit', 'render_jobs', 'saved_videos', 'subscriptions', 'system_settings',
  'user_achievements', 'user_follows', 'user_roles', 'users', 'video_comments', 'video_likes'];
const inactive = ['quran_data_sources', 'mushaf_profiles', 'reciter_catalog', 'reciter_recordings', 'recitation_coverage'];
const plan = (service: RuntimeDatabaseService = 'api') => buildRuntimePrivilegePlan({ schema: 'fixture_ayahx', user: 'fixture_api_01', service });
describe('pure explicit runtime MySQL privilege plan', () => {
  it.each(['api', 'skia', 'control'] as const)('covers all31 fixed tables exactly once for %s with qualified table scope and value parameters', service => {
    const result = plan(service);
    expect(result.statements.map(statement => statement.table)).toEqual(tables);
    expect([...Object.keys(runtimeSchemaColumns)].sort()).toEqual(tables);
    expect(new Set(result.statements.map(s => s.table)).size).toBe(31);
    for (const statement of result.statements) {
      expect(statement).toMatchObject({ schema: 'fixture_ayahx', service, scope: 'table', params: ['fixture_api_01', '%'] });
      expect(statement.sql).toContain(' ON `fixture_ayahx`.`' + statement.table + '` TO ?@?');
      expect(statement.sql).not.toContain('fixture_api_01');
      expect(statement.sql).not.toMatch(/\*|WITH GRANT OPTION|\bALL\b|\bROLE\b|\bPROXY\b|\b(?:CREATE|ALTER|DROP|TRIGGER|INDEX|REFERENCES|EXECUTE|SUPER|FILE|PROCESS|SHUTDOWN)\b|;/);
    }
  });
  it('restricts API authority grants to append/read plus the exact two revocation columns', () => {
    const result = plan();
    const grants = result.statements.find(s => s.table === 'catalog_role_grants')!;
    const audit = result.statements.find(s => s.table === 'catalog_audit_events')!;
    expect(grants.access).toEqual([{ privilege: 'SELECT' }, { privilege: 'INSERT' },
      { privilege: 'UPDATE', columns: ['revoked_at_epoch_ms', 'revocation_audit_event_id'] }]);
    expect(grants.sql).toBe('GRANT SELECT, INSERT, UPDATE (`revoked_at_epoch_ms`, `revocation_audit_event_id`) ON `fixture_ayahx`.`catalog_role_grants` TO ?@?');
    expect(audit.access).toEqual([{ privilege: 'SELECT' }, { privilege: 'INSERT' }]);
    expect(audit.sql).toBe('GRANT SELECT, INSERT ON `fixture_ayahx`.`catalog_audit_events` TO ?@?');
    expect(grants.sql).not.toMatch(/\bDELETE\b|UPDATE\s*,|UPDATE\s+ON|`(?:id|user_id|role|granting_audit_event_id|granted_at_epoch_ms)`/);
  });
  it.each(['skia', 'control'] as const)('gives %s no authority writes or administrative grants', service => {
    for (const statement of plan(service).statements.filter(s => s.classification === 'authority')) {
      expect(statement.access).toEqual([{ privilege: 'SELECT' }]);
      expect(statement.sql).toMatch(/^GRANT SELECT ON /);
    }
  });
  it.each(['api', 'skia', 'control'] as const)('keeps all5 inactive catalog tables read-only for %s', service => {
    const statements = plan(service).statements.filter(s => inactive.includes(s.table));
    expect(statements).toHaveLength(5);
    for (const statement of statements) expect(statement.access).toEqual([{ privilege: 'SELECT' }]);
  });
  it('labels legacy24-table DML as compatibility only without claiming service-minimal privileges', () => {
    for (const service of ['api', 'skia', 'control'] as const) {
      const result = plan(service); expect(result.compatibility).toBe('legacy_24_table_dml_upper_bound');
      const legacy = result.statements.filter(s => s.classification === 'legacy_compatibility'); expect(legacy).toHaveLength(24);
      for (const statement of legacy) expect(statement.access).toEqual([{ privilege: 'SELECT' }, { privilege: 'INSERT' }, { privilege: 'UPDATE' }, { privilege: 'DELETE' }]);
    }
  });
  it.each(['mysql', 'MySQL', 'sys', 'SYS', 'information_schema', 'INFORMATION_SCHEMA', 'performance_schema'])('denies system schema %s', schema => {
    expect(() => buildRuntimePrivilegePlan({ schema, user: 'fixture', service: 'api' })).toThrow();
  });
  it.each(['', ' ', 'fixture`', 'fixture.db', 'fixture;DROP DATABASE x', 'fixture/*x*/', 'fixture--', 'fixture%', 'fixture*', "fixture'", 'مكتبة', 'a'.repeat(65)])('rejects schema injection/invalid identifier %j', schema => {
    expect(() => buildRuntimePrivilegePlan({ schema, user: 'fixture', service: 'api' })).toThrow();
  });
  it.each(['', ' ', "fixture'@'%'", 'fixture`', 'fixture;GRANT ALL', 'fixture%', 'fixture-user', 'a'.repeat(33), 1])('rejects user injection/invalid identifier %j', user => {
    expect(() => buildRuntimePrivilegePlan({ schema: 'fixture', user, service: 'api' })).toThrow();
  });
  it('validates service strictly and rejects credentials, host overrides or extra privilege requests', () => {
    for (const service of ['worker', 'API', '', null, ['api']]) expect(() => buildRuntimePrivilegePlan({ schema: 'fixture', user: 'fixture', service })).toThrow();
    for (const extra of [{ password: 'not-accepted' }, { host: 'localhost' }, { grants: ['ALL'] }])
      expect(() => buildRuntimePrivilegePlan({ schema: 'fixture', user: 'fixture', service: 'api', ...extra })).toThrow();
  });
  it('accepts exact identifier boundaries without broad schema patterns', () => {
    const result = buildRuntimePrivilegePlan({ schema: 's'.repeat(64), user: 'u'.repeat(32), service: 'api' });
    expect(result.statements).toHaveLength(31);
    expect(result.accountHost).toBe('%');
    expect(result.statements.every(s => s.params[0].length === 32 && s.params[1] === '%')).toBe(true);
    expect(() => buildRuntimePrivilegePlan({ schema: 'mysql_', user: 'u', service: 'api' })).not.toThrow();
  });
  it('deep-freezes statements, access, columns and account parameters so evidence cannot broaden a reused plan', () => {
    const result = plan(); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.statements)).toBe(true);
    for (const statement of result.statements) {
      expect(Object.isFrozen(statement)).toBe(true); expect(Object.isFrozen(statement.params)).toBe(true); expect(Object.isFrozen(statement.access)).toBe(true);
      for (const entry of statement.access) { expect(Object.isFrozen(entry)).toBe(true); if (entry.columns) expect(Object.isFrozen(entry.columns)).toBe(true); }
    }
    expect(() => Reflect.set(result.statements[0], 'sql', 'GRANT ALL ON *.* TO ?@?')).not.toThrow();
    expect(result.statements[0].sql).not.toContain('*.*');
  });
});
