/** Root-only execution: one read-only SSH/MySQL session; public whitelist plus private inventory. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInventory,ENVIRONMENTS,type Inventory} from './lib/railwayQuranOps';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
import {d4Literal} from './lib/d4AuditSqlPlan';
import {isPubliclyVisible,type PublicRecitation,type CatalogDatabase} from '../server/services/catalogContracts';
import {readCatalogSettings} from '../server/services/recitationCatalogService';
import {assertFinalProtected,bindFinalPublication,storedAvailabilityProof,finalRecitationRows,finalProtectedTables,
  type EvidenceRow,type FinalPublicationPlan} from './lib/d4FinalEvidence';

const digest=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');
const readJson=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const outside=(root:string,path:string)=>{const value=relative(root,path);return value.startsWith('..')||isAbsolute(value);};
const parse=(raw:string):EvidenceRow[]=>raw.trim().split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));

/** Called only if actual active verified licensed candidates exist. No stored stamp alone grants readiness. */
async function licensedReadiness(read:(sql:string)=>Promise<EvidenceRow[]>,candidates:EvidenceRow[],settings:{storageAdapter?:'r2'|'url_reference'}):Promise<Map<string,number>>{
  const counts=new Map<string,number>();if(!candidates.length)return counts;
  // URL-based imports use the current root service implementation after cherry-pick,
  // rather than copying the separate agent worktree's older service code.
  const readiness=await import(new URL('../server/services/catalogLicensedReadiness.ts',import.meta.url).href);
  const licensed=await import(new URL('../server/services/licensedSourceResolver.ts',import.meta.url).href);
  const audio=await import(new URL('../server/services/catalogAudioSource.ts',import.meta.url).href);
  const runtime=await import(new URL('../server/services/catalogStorageRuntime.ts',import.meta.url).href);
  const projectedRead=async(sql:string,params:unknown[]=[])=>{
    const fields:readonly string[]=sql.includes('u.id source_id')?licensed.LICENSED_SOURCE_FIELDS:
      sql.includes('JOIN quran_surahs')?readiness.LICENSED_CHAPTER_FIELDS:
      sql.includes('FROM ayah_timings')?readiness.LICENSED_TIMING_FIELDS:['id'];
    let i=0;const bound=sql.replace(/\?/gu,()=>{
      const value=params[i++];assert.ok(value===null||['string','number','boolean'].includes(typeof value),'D4_FINAL_PARAMETER_INVALID');
      return d4Literal(value as string|number|boolean|null);
    });assert.equal(i,params.length,'D4_FINAL_PARAMETER_COUNT');
    return read(`SELECT JSON_OBJECT(${fields.flatMap(field=>["'"+field+"'",'_final_row.'+field]).join(',')}) record FROM (${bound}) _final_row`);
  };
  const db:CatalogDatabase={read:projectedRead,execute:async()=>{throw new Error('D4_FINAL_READ_ONLY');},transaction:async()=>{throw new Error('D4_FINAL_READ_ONLY');}};
  const source=new audio.CatalogAudioSource();
  for(const id of new Set(candidates.map(candidate=>String(candidate.recitation_id)))){
    const group=candidates.filter(candidate=>candidate.recitation_id===id),needsR2=group.some(candidate=>candidate.storage_object_id!==null);
    const storage=needsR2&&settings.storageAdapter==='r2'?runtime.catalogStorageFromEnvironment('r2','read_only',[]):null;
    try{
      const gate=new readiness.CatalogLicensedChapterReadiness(db,new licensed.CatalogLicensedSourceResolver(db,storage,source));
      let ready=0;for(const candidate of group)if(await gate.assess(id,Number(candidate.surah)))ready++;
      counts.set(id,ready);
    }finally{await storage?.close?.();}
  }
  return counts;
}

export async function captureD4FinalEvidence(argv:string[]):Promise<void>{
  const option=(name:string)=>{const index=argv.indexOf(name);if(index<0||!argv[index+1])throw new Error('D4_FINAL_OPTION_REQUIRED');return argv[index+1];};
  const root=resolve(process.cwd()),baselinePath=resolve(option('--baseline')),publicationPath=resolve(option('--publication')),
    output=resolve(option('--out')),privateOutput=resolve(option('--inventory-output'));
  assert.ok(outside(root,baselinePath)&&outside(root,privateOutput),'D4_FINAL_PRIVATE_INVENTORY_OUTSIDE_GIT_REQUIRED');
  assert.ok(privateOutput!==baselinePath,'D4_FINAL_KEEP_BASELINE');
  assert.ok(output!==publicationPath&&privateOutput!==publicationPath,'D4_FINAL_KEEP_PUBLICATION_PROOF');
  assert.ok(!outside(root,output)&&relative(root,output).replaceAll('\\','/').startsWith('docs/data/'),'D4_FINAL_PUBLIC_REPORT_PATH_INVALID');
  const baseline=readJson(baselinePath) as Inventory&{availability_fingerprint?:string};
  const publicationRaw=readFileSync(publicationPath),publication=JSON.parse(publicationRaw.toString('utf8')) as FinalPublicationPlan;
  const expected=readJson(resolve(root,'docs/data/availability-summary.json')) as {fingerprint:string;totals:Record<string,number>;recitations:Array<{slug:string}>};
  const hostPlan=readJson(resolve(root,'docs/data/d4-archive-hosts-production-plan.json')) as {passed:boolean;added_hosts:string[]};
  assert.equal(hostPlan.passed,true,'D4_FINAL_APPROVED_HOST_PLAN_REQUIRED');
  const progress=argv.includes('--progress');let readOrdinal=0;
  const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:false});
  const readSql=async(sql:string)=>{
    const ordinal=++readOrdinal,started=Date.now();
    // Fixed labels and timings only: never SQL, row values, URLs or credentials.
    if(progress)console.log(JSON.stringify({stage:'final_inventory_read',ordinal,state:'started'}));
    const result=await session.read(sql);
    if(progress)console.log(JSON.stringify({stage:'final_inventory_read',ordinal,state:'completed',elapsed_ms:Date.now()-started}));
    return result;
  };
  let publicEvidence:Record<string,unknown>|undefined,privateEvidence:Record<string,unknown>|undefined;
  try{
    const current=await captureInventory(ENVIRONMENTS.production,readSql);assertFinalProtected(current,baseline);
    const read=async(sql:string)=>parse(await readSql(sql.trimEnd().endsWith(';')?sql:sql+';'));
    const settingsDb:Pick<CatalogDatabase,'read'>={read:async()=>read("SELECT JSON_OBJECT('key_name',key_name,'value_text',value_text,'is_secret',is_secret) record FROM system_settings WHERE key_name IN ('quran_catalog_v2','availability_mode','voice_gate_policy','storage_adapter')")};
    const settings=await readCatalogSettings(settingsDb) as Awaited<ReturnType<typeof readCatalogSettings>>&{
      voiceGatePolicy:'allow_auto_verified'|'require_confirmed';storageAdapter:'url_reference'|'r2'};
    assert.ok(['allow_auto_verified','require_confirmed'].includes(settings.voiceGatePolicy)&&['url_reference','r2'].includes(settings.storageAdapter),'D4_FINAL_CURRENT_CATALOG_SETTINGS_REQUIRED');
    assert.equal(settings.enabled,false,'D4_FINAL_CATALOG_FLAG_NOT_OFF');
    const rows=await read("SELECT JSON_OBJECT('id',r.id,'slug',r.slug,'reciter_id',r.reciter_id,'name_ar',e.name_ar,'provider',p.code,'riwayah',r.riwayah_code,'channel',r.channel,'status',r.status,'published_by',r.published_by,'voice_identity_status',r.voice_identity_status,'is_public',r.is_public,'license_status',p.license_status,'offset_verified',r.offset_verified,'offset_check_score',r.offset_check_score,'verification_status',r.verification_status,'verification_method',r.verification_method,'timing_level',r.timing_level,'timing_quality',r.timing_quality,'audio_mode',r.audio_mode) record FROM recitations r JOIN reciters e ON e.id=r.reciter_id JOIN audio_providers p ON p.id=r.provider_id ORDER BY r.slug");
    assert.equal(rows.length,current.row_counts.recitations,'D4_FINAL_CATALOG_ROWS_MISSING');
    assert.equal(new Set(rows.map(row=>row.slug)).size,rows.length,'D4_FINAL_DUPLICATE_CATALOG_SLUG');
    assert.deepEqual(rows.map(row=>String(row.slug)).sort(),expected.recitations.map(row=>row.slug).sort(),'D4_FINAL_CATALOG_SLUGS_CHANGED');
    const chapters=await read("SELECT JSON_OBJECT('id',c.id,'recitation_id',c.recitation_id,'surah',c.surah,'canonical',r.canonical_text_available,'available_ayahs',c.available_ayahs,'coverage_mismatch',c.coverage_mismatch,'availability_state',c.availability_state,'available_runs',c.available_runs,'run_count',c.run_count,'max_run_ayahs',c.max_run_ayahs,'ready_ayahs',c.ready_ayahs,'near_complete_missing',c.near_complete_missing,'audio_status',c.audio_status,'checked_epoch_ms',UNIX_TIMESTAMP(c.last_verified_at)*1000) record FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id ORDER BY c.id");
    const blockedReady=await read("SELECT JSON_OBJECT('chapter_id',c.id,'ayah',t.ayah) record FROM recitation_chapters c STRAIGHT_JOIN recitations r ON r.id=c.recitation_id STRAIGHT_JOIN ayah_timings t ON t.recitation_id=c.recitation_id AND t.surah=c.surah WHERE r.canonical_text_available=1 AND (c.coverage_mismatch=1 OR c.available_ayahs=0) AND t.expected_words IS NOT NULL AND t.coverage_words=t.expected_words AND t.review_status='ready' AND JSON_LENGTH(t.review_reasons)=0 AND JSON_LENGTH(t.missing_words)=0 ORDER BY c.id,t.ayah");
    const coverage=storedAvailabilityProof(chapters,blockedReady);
    assert.equal(coverage.fingerprint,baseline.availability_fingerprint??expected.fingerprint,'D4_FINAL_T2_FINGERPRINT_CHANGED');
    assert.equal(coverage.fingerprint,expected.fingerprint,'D4_FINAL_T2_ACCEPTED_FINGERPRINT_CHANGED');
    const totals:Record<string,number>={complete:0,near_complete:0,partial:0,unavailable:0};
    for(const chapter of coverage.chapters)totals[chapter.availability_state]++;
    totals.unavailable+=rows.length*current.d1_counts.surahs-coverage.chapters.length;
    assert.deepEqual(totals,expected.totals,'D4_FINAL_T2_TOTALS_CHANGED');
    const nowMs=Date.now(),decisions=bindFinalPublication(rows,chapters,publication,nowMs);
    const candidates=await read("SELECT JSON_OBJECT('recitation_id',recitation_id,'surah',surah,'storage_object_id',storage_object_id) record FROM recitation_source_urls WHERE kind='licensed_file' AND is_active=1 AND verification_status='verified'");
    const licensedReady=await licensedReadiness(read,candidates,settings);
    const policyVisibility=isPubliclyVisible as (row:PublicRecitation,enabled:boolean,policy?:'allow_auto_verified'|'require_confirmed')=>boolean;
    const visible=(row:EvidenceRow,enabled:boolean,policy?:string)=>policyVisibility(row as unknown as PublicRecitation,enabled,policy as 'allow_auto_verified'|'require_confirmed');
    const recitations=finalRecitationRows(rows,chapters,decisions,licensedReady,candidates,settings,visible);
    const reviews=await read("SELECT JSON_OBJECT('type',type,'status',status,'count',COUNT(*)) record FROM human_review_items GROUP BY type,status ORDER BY type,status");
    const reviewCounts:Record<string,number>={},pendingCounts:Record<string,number>={},statusCounts:Record<string,number>={};
    for(const row of reviews){const type=String(row.type),status=String(row.status),count=Number(row.count);assert.ok(Number.isSafeInteger(count)&&count>=0);reviewCounts[type]=(reviewCounts[type]??0)+count;pendingCounts[type]=(pendingCounts[type]??0)+(status==='pending'?count:0);statusCounts[status]=(statusCounts[status]??0)+count;}
    const providers=await read("SELECT JSON_OBJECT('code',code,'license_status',license_status,'host_allowlist',host_allowlist) record FROM audio_providers ORDER BY code");
    const hosts=new Set<string>();for(const provider of providers){const allowed=typeof provider.host_allowlist==='string'?JSON.parse(provider.host_allowlist):provider.host_allowlist;assert.ok(Array.isArray(allowed)&&allowed.every(host=>typeof host==='string'&&/^(?:\*\.)?[a-z0-9.-]+$/iu.test(host)),'D4_FINAL_PROVIDER_HOSTS_INVALID');for(const host of allowed)hosts.add(host);}
    const addedHosts=hostPlan.added_hosts.map(host=>{assert.ok(hosts.has(host),'D4_FINAL_APPROVED_HOST_MISSING');return {host,reason:'Live allowlist matches approved K2 redirect/TLS/ownership evidence',evidence_ref:'docs/data/d4-archive-hosts-production-plan.json'};});
    const constraints=await read("SELECT JSON_OBJECT('table',t.TABLE_NAME,'name',t.CONSTRAINT_NAME,'enforced',t.ENFORCED,'clause',c.CHECK_CLAUSE) record FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.CONSTRAINT_TYPE='CHECK' ORDER BY t.TABLE_NAME,t.CONSTRAINT_NAME");
    const columns=await read("SELECT JSON_OBJECT('table',TABLE_NAME,'column',COLUMN_NAME,'type',COLUMN_TYPE,'nullable',IS_NULLABLE,'charset',CHARACTER_SET_NAME,'collation',COLLATION_NAME) record FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('reciters','recitations','recitation_chapters','recitation_source_urls','recitation_youtube_sources','audio_providers','human_review_items','storage_objects','ayah_timings','quran_surahs','quran_ayahs','quran_words') ORDER BY TABLE_NAME,ORDINAL_POSITION");
    const connectionRaw=await session.read("SHOW GLOBAL STATUS LIKE 'Threads_connected'; SHOW GLOBAL VARIABLES LIKE 'max_connections';");
    const connection=Object.fromEntries(connectionRaw.trim().split(/\r?\n/u).map(line=>line.split('\t'))),threads=Number(connection.Threads_connected),maximum=Number(connection.max_connections);
    assert.ok(Number.isSafeInteger(threads)&&threads>=1&&Number.isSafeInteger(maximum)&&threads<maximum,'D4_FINAL_CONNECTION_LIMIT');
    const disk=await session.storage(),protectedTables=Object.fromEntries(finalProtectedTables.map(name=>[name,{rows:current.row_counts[name],checksum:current.checksums[name],unchanged:true}]));
    const checkedAt=new Date().toISOString();
    publicEvidence={read_only:true,checked_at:checkedAt,publication_sha256:digest(publicationRaw),publication_plan_replay_changes:publication.changes,
      mysql_version:current.mysql_version,recitations,flag_enabled:settings.enabled,settings,
      review_counts_by_type:reviewCounts,review_pending_counts_by_type:pendingCounts,review_status_totals:statusCounts,review_counts:reviews,
      added_hosts:addedHosts,providers,constraints,columns,disk,threads_connected:threads,max_connections:maximum,
      d1:current.d1_counts,d3_rows:current.row_counts.ayah_timings,canonical_checksum:current.canonical_checksum,protected_tables:protectedTables,
      availability_fingerprint:coverage.fingerprint,availability_totals:totals,
      protected_verification_summary:'Verified baseline match: D1 '+JSON.stringify(current.d1_counts)+'; D3 '+current.row_counts.ayah_timings+'; canonical '+current.canonical_checksum+'; users/user_roles and all D1/D3 protected table counts/checksums unchanged; T2 '+coverage.fingerprint,
      eligible_recitations:recitations.filter(row=>row.rule_v1_eligible).length,
      eligible_readers:new Set(recitations.filter(row=>row.rule_v1_eligible).map(row=>row.reciter_id)).size,
      public_visible_count:recitations.filter(row=>row.public_visible).length,verified_licensed_candidate_count:candidates.length,database_writes:0};
    privateEvidence={...current,disk,availability_fingerprint:coverage.fingerprint,availability_totals:totals,final_checked_at:checkedAt};
  }finally{
    const serial=await session.close();if(publicEvidence)publicEvidence.serial=serial;
  }
  assert.ok(publicEvidence&&privateEvidence,'D4_FINAL_CAPTURE_NOT_COMPLETE');
  writeFileSync(privateOutput,JSON.stringify(privateEvidence,null,2)+'\n');
  writeFileSync(output,JSON.stringify(publicEvidence,null,2)+'\n');
  console.log(JSON.stringify({passed:true,read_only:true,recitations:(publicEvidence.recitations as unknown[]).length,
    eligible:publicEvidence.eligible_recitations,public_visible:publicEvidence.public_visible_count,sha256:digest(readFileSync(output)),database_writes:0}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  captureD4FinalEvidence(process.argv.slice(2)).catch(error=>{
    const code=error instanceof Error?error.message.match(/\b(?:D4_FINAL|RAILWAY|MYSQL)_[A-Z0-9_]+\b/u)?.[0]:undefined;
    console.error(JSON.stringify({passed:false,code:code??'D4_FINAL_EVIDENCE_CAPTURE_FAILED',database_writes:0}));process.exitCode=1;
  });
}
