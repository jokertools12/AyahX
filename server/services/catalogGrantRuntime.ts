import { pool } from '../db';
import { createCatalogGrantService } from './catalogGrantService';
import { createCatalogContentApprovalService } from './catalogContentApprovalService';

// Runtime mutations derive authority from current database rows, never JWT role claims.
// Owner bootstrap remains a separately invoked privileged CLI operation.
export const catalogGrantService = createCatalogGrantService(() => pool.getConnection());
export const catalogContentApprovalService = createCatalogContentApprovalService(
  async () => {
    const connection = await pool.getConnection();
    return {
      query: async (sql: string, parameters?: unknown[]) => {
        const [rows, fields] = await connection.query(sql, parameters as any);
        return [rows as unknown[], fields] as [unknown[], unknown];
      },
      beginTransaction: () => connection.beginTransaction(),
      commit: () => connection.commit(),
      rollback: () => connection.rollback(),
      release: () => connection.release(),
    };
  },
  actorId => catalogGrantService.authorize(actorId, 'content_approve'),
);
