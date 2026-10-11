import { pool } from '../db';
import { catalogDatabaseFromPool } from './catalogMysqlDatabase';
import { CatalogAudioSource } from './catalogAudioSource';
import { RecitationAudioResolver } from './recitationAudioResolver';
import { RecitationCatalogService,readCatalogSettings } from './recitationCatalogService';
import { CatalogPeriodicLinkChecker } from './catalogPeriodicLinkChecker';
import {catalogStorageFromEnvironment} from './catalogStorageRuntime';
import {CatalogLicensedSourceResolver} from './licensedSourceResolver';
import {CatalogLicensedChapterReadiness} from './catalogLicensedReadiness';
import {LaunchReadinessService} from './launchReadinessService';
import {CatalogWeeklyStorageReconciliation,privateStorageReportWriter} from './catalogWeeklyStorageReconciliation';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const db=catalogDatabaseFromPool(pool);
const settings=()=>readCatalogSettings(db);
const source=new CatalogAudioSource();
// No credentials are consulted while the default url_reference adapter is selected.
const licensedGate={async isChapterReady(id:string,surah:number,completeOnly=true){const configuration=await settings();const storage=catalogStorageFromEnvironment(configuration.storageAdapter??'url_reference','read_only',[]);try{return await new CatalogLicensedChapterReadiness(db,new CatalogLicensedSourceResolver(db,storage.adapter==='r2'?storage:null,source)).isChapterReady(id,surah,completeOnly);}finally{await storage.close?.();}}};
export const catalogService=new RecitationCatalogService(db,settings,{async resolveAudioPlan(input){const configuration=await settings();const storage=catalogStorageFromEnvironment(configuration.storageAdapter??'url_reference','read_only',[]);try{const licensed={storage,resolver:new CatalogLicensedSourceResolver(db,storage.adapter==='r2'?storage:null,source)};return await new RecitationAudioResolver(db,source,settings,licensed).resolveAudioPlan(input);}finally{await storage.close?.();}}},licensedGate);
export const catalogLaunchReadiness=new LaunchReadinessService(db,licensedGate);
export const catalogLinkChecker=new CatalogPeriodicLinkChecker(db,undefined,source);
// Audit JSON persists in MySQL; private file copy may be ephemeral across redeployments.
export const catalogStorageReconciliation=new CatalogWeeklyStorageReconciliation({db,storageProvider:()=>catalogStorageFromEnvironment('r2','read_only',[]),writeReport:privateStorageReportWriter(join(tmpdir(),'ayahx-storage-reports'))});
