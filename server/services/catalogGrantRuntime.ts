import { pool } from '../db';
import { createCatalogGrantService } from './catalogGrantService';
import { createCatalogContentApprovalService } from './catalogContentApprovalService';

// Runtime mutations derive authority from current database rows, never JWT role claims.
// Owner bootstrap remains a separately invoked privileged CLI operation.
export const catalogGrantService = createCatalogGrantService(() => pool.getConnection());
export const catalogContentApprovalService = createCatalogContentApprovalService(
  () => pool.getConnection(),
  actorId => catalogGrantService.authorize(actorId, 'content_approve'),
);
