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
import { registerRenderLabEndpoints } from '../routes/admin/adminRenderLab';
import { RenderLabService } from '../services/renderLabService';
import { CatalogRenderManifestService } from '../services/catalogRenderManifest';
import { readCatalogSettings } from '../services/recitationCatalogService';
import { catalogStorageFromEnvironment } from '../services/catalogStorageRuntime';
import { CatalogLicensedSourceResolver } from '../services/licensedSourceResolver';
import { enqueueRenderJob } from '../services/renderQueueBroker';
import { AdminOwnerWorkspace } from './adminOwnerWorkspace';
import { registerAdminA2bEndpoints } from '../routes/admin/adminA2bEndpoints';
import { AdminMediaWorkspace } from './adminMediaWorkspace';
import { AdminMediaTasks } from './adminMediaTasks';
import { AdminReciterWizard } from './adminReciterWizard';
import { AdminRenderMedia } from './adminRenderMedia';
import { registerAdminMediaEndpoints } from '../routes/admin/adminMediaEndpoints';

export interface AdminRuntimeOptions {
  db: CatalogDatabase;
  catalog: Pick<RecitationCatalogService, 'publicVisibilityReasons'>;
  source: CatalogAudioSource;
  env?: NodeJS.ProcessEnv;
  origins?: readonly string[];
  rate?: AdminRateGate;
}

/** Same authorization/admission service for HTTP and the root-operated SSH CLI. */
export function createRenderLabService(db: CatalogDatabase, source: CatalogAudioSource, env: NodeJS.ProcessEnv = process.env): RenderLabService {
  return new RenderLabService(db, createRenderLabBuilder(db,source,env), id => enqueueRenderJob(id, 'skia_canvas', 0, { attempts: 1 }));
}
export function createRenderLabBuilder(db: CatalogDatabase, source: CatalogAudioSource, env: NodeJS.ProcessEnv = process.env) {
  return { async build(request:unknown) {
    const settings = await readCatalogSettings(db);
    const storage = catalogStorageFromEnvironment(settings.storageAdapter ?? 'url_reference', 'read_only', [], env);
    try { return await new CatalogRenderManifestService({ db, source, licensedStorage: storage,
      licensedResolver: new CatalogLicensedSourceResolver(db, storage.adapter === 'r2' ? storage : null, source),
    }).build(request); } finally { await storage.close?.(); }
  } };
}

/** Constructors perform no I/O or migrations. Only the public API process starts tasks. */
export function createAdminRuntime(options: AdminRuntimeOptions) {
  const env = options.env ?? process.env;
  const access = new AdminAccessService(options.db, env);
  const rate = options.rate ?? new RedisAdminRateGate(env);
  const links = new CatalogPeriodicLinkChecker(options.db, undefined, options.source);
  const worker = new AdminCatalogTaskWorker(options.db, (id, context) => access.actorForUser(id, context), links);
  const lab = createRenderLabService(options.db, options.source, env);
  const media = new AdminMediaWorkspace(options.db,options.source,env);
  const mediaTasks = new AdminMediaTasks(options.db,media,(id,context)=>access.actorForUser(id,context),env);
  const renderMedia = new AdminRenderMedia(options.db,createRenderLabBuilder(options.db,options.source,env));
  const router = createAdminApplicationRouter({
    db: options.db, access, rate, env, origins: options.origins,
    register: register => { registerCatalogAdminEndpoints(register, {
      db: options.db,
      catalog: new AdminCatalogService(options.db, new RecitationAdminService(options.db, options.source), new AdminCatalogImageValidator(), row => options.catalog.publicVisibilityReasons(row)),
      read: new AdminCatalogReadService(options.db),
      tasks: new AdminCatalogTaskService(options.db),
      reviews: new HumanReviewService(options.db),
    }); registerRenderLabEndpoints(register, lab, renderMedia); registerAdminA2bEndpoints(register, new AdminOwnerWorkspace(options.db,process.cwd(),{isChapterReady:(id,surah,complete)=>media.isLicensedChapterReady(id,surah,complete)},env)); registerAdminMediaEndpoints(register,media,mediaTasks,new AdminReciterWizard(options.db,options.source)); },
  });
  let stopping: Promise<void> | undefined, closing: Promise<void> | undefined;
  const stopTasks = (): Promise<void> => stopping ??= Promise.all([worker.close(),mediaTasks.close()]).then(()=>{});
  return {
    router, worker,
    start: () => {worker.start();mediaTasks.start();},
    stopTasks,
    // Redis closes after HTTP drains, so an in-flight authenticated request
    // never recreates a connection during shutdown. Tasks drain before MySQL.
    close: (): Promise<void> => closing ??= stopTasks().finally(() => rate.close?.()),
  };
}

/** Express routes are case-insensitive by default; do not bypass admin CORS on lookalikes. */
export const isAdminApiPath = (path: string): boolean => /^\/api\/admin(?:\/|$)/iu.test(path);
