import { describe, expect, it } from 'vitest';
import { buildRuntimePrivilegePlan } from '../../server/db/runtimePrivilegePlan';
import { verifyRuntimeGrants } from '../../server/db/runtimeGrantVerification';
const plan = buildRuntimePrivilegePlan({ schema: 'railway', user: 'fixture_runtime', service: 'api' });
const grants = () => plan.statements.map(s => s.sql.replace('?@?', '`fixture_runtime`@`%`'));
const input = () => ({ currentUser: 'fixture_runtime@%', activeRoles: 'NONE', grants: grants() });
describe('effective runtime direct-grant verification', () => {
  it('accepts exactly the reviewed grants with optional USAGE and reordered columns', () => {
    const value = input(); value.grants.push('GRANT USAGE ON *.* TO `fixture_runtime`@`%`');
    value.grants = value.grants.map(s => s.replace('`revoked_at_epoch_ms`, `revocation_audit_event_id`', '`revocation_audit_event_id`, `revoked_at_epoch_ms`')).reverse();
    expect(verifyRuntimeGrants(plan, value).tableCount).toBe(31);
  });
  it.each([
    'GRANT ALL PRIVILEGES ON *.* TO `fixture_runtime`@`%`',
    'GRANT SELECT ON `railway`.* TO `fixture_runtime`@`%`',
    'GRANT SELECT ON `another_schema`.`users` TO `fixture_runtime`@`%`',
    'GRANT TRIGGER ON `railway`.`catalog_audit_events` TO `fixture_runtime`@`%`',
    'GRANT UPDATE ON `railway`.`catalog_audit_events` TO `fixture_runtime`@`%`',
    'GRANT UPDATE ON `railway`.`catalog_role_grants` TO `fixture_runtime`@`%`',
    'GRANT UPDATE (`role`) ON `railway`.`catalog_role_grants` TO `fixture_runtime`@`%`',
    'GRANT DELETE ON `railway`.`catalog_role_grants` TO `fixture_runtime`@`%`',
    'GRANT SELECT ON `railway`.`users` TO `fixture_runtime`@`%` WITH GRANT OPTION',
    'GRANT `powerful_role`@`%` TO `fixture_runtime`@`%`',
    'GRANT BACKUP_ADMIN ON *.* TO `fixture_runtime`@`%`',
    'GRANT EXECUTE ON PROCEDURE `railway`.`privileged` TO `fixture_runtime`@`%`',
    'GRANT SELECT ON `railway`.`users` TO `another_user`@`%`',
  ])('rejects extra authority: %s', extra => {
    const value = input(); value.grants.push(extra); expect(() => verifyRuntimeGrants(plan, value)).toThrow('RUNTIME_EFFECTIVE_GRANTS_MISMATCH');
  });
  it('rejects missing grants, an unexpected effective account or active roles', () => {
    const value = input(); value.grants.pop(); expect(() => verifyRuntimeGrants(plan, value)).toThrow();
    expect(() => verifyRuntimeGrants(plan, { ...input(), currentUser: 'root@localhost' })).toThrow();
    expect(() => verifyRuntimeGrants(plan, { ...input(), activeRoles: '`unexpected`@`%`' })).toThrow();
  });
  it('accepts separate statements for table and column privileges without broadening them', () => {
    const value = input(); const index = value.grants.findIndex(s => s.includes('`catalog_role_grants`'));
    value.grants.splice(index, 1, 'GRANT SELECT, INSERT ON `railway`.`catalog_role_grants` TO `fixture_runtime`@`%`',
      'GRANT UPDATE (`revoked_at_epoch_ms`, `revocation_audit_event_id`) ON `railway`.`catalog_role_grants` TO `fixture_runtime`@`%`');
    expect(verifyRuntimeGrants(plan, value).tableCount).toBe(31);
  });
});
