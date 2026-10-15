import type { Connection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';

const label = z.string().min(1).max(200).refine(value => value.trim() === value);
/** Runtime-safe identity inspection: no application pool, filesystem or migration imports. */
export const databaseTargetSchema = z.object({
  environment: z.enum(['local', 'staging', 'production']), host: label,
  port: z.number().int().positive(), serverUuid: label, schema: label, version: label,
}).strict();
export type DatabaseTarget = z.infer<typeof databaseTargetSchema>;

export async function inspectDatabaseIdentity(connection: Pick<Connection, 'query'>,
  environment: DatabaseTarget['environment']): Promise<DatabaseTarget> {
  const [result] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS schemaName, @@hostname AS host, @@port AS port, @@server_uuid AS serverUuid, @@version AS version');
  const [row] = result;
  return databaseTargetSchema.parse({ environment, host: row.host, port: Number(row.port),
    serverUuid: row.serverUuid, schema: row.schemaName, version: row.version });
}
