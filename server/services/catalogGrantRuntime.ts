import { pool } from '../db';
import { createCatalogGrantService } from './catalogGrantService';

// Runtime mutations derive authority from current database rows, never JWT role claims.
// Owner bootstrap remains a separately invoked privileged CLI operation.
export const catalogGrantService = createCatalogGrantService(() => pool.getConnection());
