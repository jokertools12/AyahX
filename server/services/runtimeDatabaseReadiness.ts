import { query } from '../db';
import { createRuntimeSchemaCheck, type RuntimeSchemaColumn } from '../db/runtimeSchemaReadiness';

export const assertRuntimeSchemaReady = createRuntimeSchemaCheck(sql => query<RuntimeSchemaColumn[]>(sql));
