import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { databaseTargetSchema, inspectDatabaseIdentity, type DatabaseTarget } from './databaseIdentity';
import { buildRuntimePrivilegePlan, runtimeDatabaseServiceSchema, type RuntimeDatabaseService, type RuntimePrivilegePlan } from './runtimePrivilegePlan';
import { createRuntimeSchemaCheck, type RuntimeSchemaColumn } from './runtimeSchemaReadiness';
import { canonicalJson, hashBytes } from '../utils/canonicalIntegrity';

export type RuntimePrincipalOptions = { target: DatabaseTarget; user: string; service: RuntimeDatabaseService;
  mode: 'inspect' | 'apply'; password?: string };
export type RuntimePrincipalResult = Readonly<{ status: 'inspected' | 'applied'; plan: RuntimePrivilegePlan }>;
const optionsSchema = z.object({ target: databaseTargetSchema, user: z.string(), service: runtimeDatabaseServiceSchema,
  mode: z.enum(['inspect', 'apply']), password: z.string().optional() }).strict().superRefine((options, context) => {
  if (options.mode === 'apply' && !z.string().min(32).max(256).safeParse(options.password).success)
    context.addIssue({ code: 'custom', path: ['password'], message: 'RUNTIME_PRINCIPAL_PASSWORD_REQUIRED' });
});

/**
 * New principals ONLY. Account DDL/GRANT auto-commit: failures leave an incomplete principal for operator review.
 * No retry, rollback claim, ALTER/DROP, credential output or connection ownership transfer.
 * The privileged CLI must independently verify trusted platform environment and reserve private files before connecting,
 * then verify CURRENT_USER/CURRENT_ROLE and exact effective grants with the new login before application configuration.
 */
export async function provisionRuntimePrincipal(connection: Pick<Connection, 'query'>,
  optionsInput: RuntimePrincipalOptions): Promise<RuntimePrincipalResult> {
  const { target, user, service, mode, password } = optionsSchema.parse(optionsInput);
  const plan = buildRuntimePrivilegePlan({ schema: target.schema, user, service });
  const actual = await inspectDatabaseIdentity(connection, target.environment);
  if (canonicalJson(actual) !== canonicalJson(target)) throw new Error('RUNTIME_PRINCIPAL_TARGET_MISMATCH');
  const lock = `ayahx_catalog_${hashBytes(target.schema).slice(0, 32)}`;
  let acquired = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [lock]);
    if (lockRows.length !== 1 || Number(lockRows[0].acquired) !== 1) throw new Error('RUNTIME_PRINCIPAL_LOCK_UNAVAILABLE');
    acquired = true;
    const [roles] = await connection.query<RowDataPacket[]>('SELECT @@GLOBAL.mandatory_roles AS mandatoryRoles');
    if (roles.length !== 1 || typeof roles[0].mandatoryRoles !== 'string' || roles[0].mandatoryRoles.trim() !== '')
      throw new Error('RUNTIME_PRINCIPAL_MANDATORY_ROLES_PRESENT');
    const [accounts] = await connection.query<RowDataPacket[]>(
      'SELECT User AS user, Host AS host FROM mysql.user WHERE BINARY User = BINARY ?', [user]);
    if (accounts.length !== 0) throw new Error('RUNTIME_PRINCIPAL_ALREADY_EXISTS');
    // A fresh metadata preflight per provisioning attempt; never runtime schema DDL or application rows.
    await createRuntimeSchemaCheck(async sql => {
      const [columns] = await connection.query<RowDataPacket[]>(sql);
      return columns as RuntimeSchemaColumn[];
    })();
    if (mode === 'inspect') return Object.freeze({ status: 'inspected', plan });
    await connection.query('CREATE USER ?@? IDENTIFIED BY ?', [user, '%', password]);
    for (const statement of plan.statements) await connection.query(statement.sql, [...statement.params]);
    return Object.freeze({ status: 'applied', plan });
  } finally {
    if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [lock]);
  }
}
