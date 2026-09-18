import { query } from '../../db';
import { logger } from '../../logger';

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await query<Array<{ present: number }>>(
    `SELECT 1 AS present
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function ensurePaymentColumn(table: string, column: string, definition: string): Promise<void> {
  if (!await hasColumn(table, column)) {
    await query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    logger.info(`Database migration: added ${table}.${column}.`);
  }
}

/**
 * Supports installations created before the plan entitlement split.  This is
 * deliberately startup-safe: new installs get the same schema from schema.sql,
 * while deployed installations gain the cloud counter and checkout fields
 * without a manual migration step.
 */
export async function ensurePlanEntitlementSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS \`daily_cloud_render_usage\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`user_id\` VARCHAR(36) NOT NULL,
      \`date\` DATE NOT NULL,
      \`count\` INT NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uk_cloud_render_usage_user_date\` (\`user_id\`, \`date\`),
      INDEX \`idx_cloud_render_usage_date\` (\`date\`),
      CONSTRAINT \`fk_cloud_render_usage_user\`
        FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Payment request rows already exist in older deployments; add only the
  // missing data needed for server-authoritative checkout verification.
  await ensurePaymentColumn('payment_requests', 'currency', "CHAR(3) NOT NULL DEFAULT 'EGP' AFTER amount");
  await ensurePaymentColumn('payment_requests', 'transfer_reference', 'VARCHAR(100) DEFAULT NULL AFTER phone_number');

  logger.info('Database migration: verified plan entitlement schema readiness.');
}
