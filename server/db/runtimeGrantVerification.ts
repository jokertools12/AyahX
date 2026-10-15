import type { RuntimePrivilegePlan } from './runtimePrivilegePlan';
import { hashBytes } from '../utils/canonicalIntegrity';

/** Exact direct-grant allowlist. Provisioning separately requires a NEW principal and no mandatory roles. */
export function verifyRuntimeGrants(plan: RuntimePrivilegePlan, input: { currentUser: string; activeRoles: string; grants: string[] }) {
  function fail(): never { throw new Error('RUNTIME_EFFECTIVE_GRANTS_MISMATCH'); }
  if (input.currentUser !== `${plan.user}@%` || input.activeRoles !== 'NONE' || !Array.isArray(input.grants)) fail();
  const expected = new Set<string>();
  const objects = new Map(plan.statements.map(statement => [`\`${plan.schema}\`.\`${statement.table}\``, statement.table]));
  for (const statement of plan.statements) for (const access of statement.access) {
    for (const column of access.columns ?? ['*']) expected.add(`${statement.table}:${access.privilege}:${column}`);
  }
  const actual = new Set<string>();
  const suffix = ` TO \`${plan.user}\`@\`%\``;
  for (const raw of input.grants) {
    if (typeof raw !== 'string') fail();
    const grant = raw.replace(/\s+/g, ' ').trim();
    if (!grant.endsWith(suffix) || !grant.startsWith('GRANT ')) fail();
    const body = grant.slice(6, -suffix.length);
    const separator = body.indexOf(' ON ');
    if (separator < 0) fail(); // Includes role, PROXY and unsupported grant forms.
    const privileges = body.slice(0, separator);
    const object = body.slice(separator + 4);
    if (object === '*.*' && privileges === 'USAGE') continue;
    const table = objects.get(object); if (!table) fail();
    for (const item of privileges.split(/,(?![^()]*\))/)) {
      const match = /^(SELECT|INSERT|UPDATE|DELETE)(?: \(([^()]+)\))?$/.exec(item.trim());
      if (!match) fail();
      const columns = match[2] ? match[2].split(',').map(value => value.trim().replace(/^`([A-Za-z0-9_]+)`$/, '$1')) : ['*'];
      for (const column of columns) {
        if (column !== '*' && !/^[A-Za-z0-9_]+$/.test(column)) fail();
        const point = `${table}:${match[1]}:${column}`;
        if (!expected.has(point)) fail();
        actual.add(point);
      }
    }
  }
  if (actual.size !== expected.size || [...expected].some(point => !actual.has(point))) fail();
  return { tableCount: plan.statements.length, privilegePointCount: actual.size,
    effectiveGrantsSha256: hashBytes([...actual].sort().join('\n')) };
}
