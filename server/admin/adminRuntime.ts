import type { CatalogDatabase } from '../services/catalogContracts';
import type { RecitationCatalogService } from '../services/recitationCatalogService';
import { CatalogAudioSource } from '../services/catalogAudioSource';
import { CatalogPeriodicLinkChecker } from '../services/catalogPeriodicLinkChecker';
import { RecitationAdminService } from '../services/recitationAdminService';
import { AdminCatalogImageValidator } from '../services/adminCatalogImageValidator';
import { AdminCatalogService } from '../services/adminCatalogService';
import { AdminCatalogReadService } from '../services/adminCatalogReadService';
import { AdminCatalogTaskService, AdminCatalogTaskWorker } from '../services/adminCatalogTasks';
import { HumanReviewService } from '../services/humanReviewService';
import { registerCatalogAdminEndpoints } from '../routes/adminCatalog';
import { createAdminApplicationRouter } from '../routes/admin/adminA1Endpoints';
import { AdminAccessService } from './adminAccessService';
import { RedisAdminRateGate, type AdminRateGate } from './adminRateGate';

export interface AdminRuntimeOptions {
  db: CatalogDatabase;
  catalog: Pick<RecitationCatalogService, 'publicVisibilityReasons'>;
  source: CatalogAudioSource;
  env?: NodeJS.ProcessEnv;
  origins?: readonly string[];
  rate?: AdminRateGate;
}

/** Constructors perform no I/O or migrations. Only the public API process starts tasks. */
export function createAdminRuntime(options: AdminRuntimeOptions) {
  const env = options.env ?? process.env;
  const access = new AdminAccessService(options.db, env);
  const rate = options.rate ?? new RedisAdminRateGate(env);
  const links = new CatalogPeriodicLinkChecker(options.db, undefined, options.source);
  const worker = new AdminCatalogTaskWorker(options.db, (id, context) => access.actorForUser(id, context), links);
  const router = createAdminApplicationRouter({
    db: options.db, access, rate, env, origins: options.origins,
    register: register => registerCatalogAdminEndpoints(register, {
      db: options.db,
      catalog: new AdminCatalogService(options.db, new RecitationAdminService(options.db, options.source), new AdminCatalogImageValidator(), row => options.catalog.publicVisibilityReasons(row)),
      read: new AdminCatalogReadService(options.db),
      tasks: new AdminCatalogTaskService(options.db),
      reviews: new HumanReviewService(options.db),
    }),
  });
  let stopping: Promise<void> | undefined, closing: Promise<void> | undefined;
  const stopTasks = (): Promise<void> => stopping ??= worker.close();
  return {
    router, worker,
    start: () => worker.start(),
    stopTasks,
    // Redis closes after HTTP drains, so an in-flight authenticated request
    // never recreates a connection during shutdown. Tasks drain before MySQL.
    close: (): Promise<void> => closing ??= stopTasks().finally(() => rate.close?.()),
  };
}

/** Express routes are case-insensitive by default; do not bypass admin CORS on lookalikes. */
export const isAdminApiPath = (path: string): boolean => /^\/api\/admin(?:\/|$)/iu.test(path);
