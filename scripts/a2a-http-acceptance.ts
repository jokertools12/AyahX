/** ROOT RUNS ONLY. Real HTTP + disposable MySQL fixtures; never run against Railway. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import mysql,{type RowDataPacket} from 'mysql2/promise';
import Redis from 'ioredis';
import {registerCatalogAdminEndpoints} from '../server/routes/adminCatalog';
import type {AdminEndpointDefinition} from '../server/admin/adminContracts';
import {catalogDatabaseFromPool} from '../server/services/catalogMysqlDatabase';
import {AdminCatalogReadService} from '../server/services/adminCatalogReadService';
import type {CatalogRow} from '../server/services/catalogContracts';

if(!process.argv.includes('--allow-local-fixture-writes'))throw new Error('LOCAL_FIXTURE_WRITE_ACK_REQUIRED');
const mysqlUrl=process.env.A2A_MYSQL_URL;if(!mysqlUrl)throw new Error('A2A_MYSQL_URL_REQUIRED');
const mysqlAddress=new URL(mysqlUrl),base=new URL(process.env.A2A_HTTP_BASE??'http://localhost:3001');
const local=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
assert.ok(local(mysqlAddress.hostname)&&local(base.hostname),'LOCAL_HOSTS_REQUIRED');
assert.match(mysqlAddress.pathname.slice(1),/^ayahx_d2_a1_[a-z0-9_]+$/u,'DISPOSABLE_A1_SCHEMA_REQUIRED');
const redisUrl=process.env.A2A_REDIS_URL??'redis://127.0.0.1:6380/10';assert.ok(local(new URL(redisUrl).hostname),'LOCAL_REDIS_REQUIRED');
const pool=mysql.createPool({uri:mysqlUrl,connectionLimit:3}),db=catalogDatabaseFromPool(pool),redis=new Redis(redisUrl),read=new AdminCatalogReadService(db);
const directory=join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'AyahX','private-backups');
const manifestFile=join(directory,'a2a-browser-catalog-fixtures.json');
if(process.argv.includes('--cleanup')){
  const manifest=JSON.parse(await readFile(manifestFile,'utf8')) as {local_only:boolean;schema:string;prefix:string;fixture:{primary:string;secondary:string;partial:string;provider:string};created:Array<{table:string;id:string}>;restore:{settings:Array<[string,CatalogRow|null]>;riwayat:Array<[string,unknown]>;ranks:Record<string,CatalogRow[]>}};
  assert.equal(manifest.local_only,true);assert.equal(manifest.schema,mysqlAddress.pathname.slice(1));assert.match(manifest.prefix,/^a2a-http-[a-f0-9]{8}$/u);
  const [version]=await db.read('SELECT VERSION() version');assert.equal(version.version,'9.7.2');
  for(const [key,row]of manifest.restore.settings)if(row)await db.execute('UPDATE system_settings SET value_text=?,is_secret=?,category=? WHERE key_name=?',[row.value_text,row.is_secret,row.category,key]);else await db.execute('DELETE FROM system_settings WHERE key_name=?',[key]);
  for(const [id,value]of manifest.restore.riwayat)await db.execute('UPDATE riwayat SET is_active=? WHERE id=?',[value,id]);
  for(const [table,rows]of Object.entries(manifest.restore.ranks)){assert.ok(['reciters','recitations'].includes(table));for(const row of rows)await db.execute('UPDATE '+table+' SET sort_order=? WHERE id=?',[row.sort_order,row.id]);}
  for(const id of [manifest.fixture.primary,manifest.fixture.secondary,manifest.fixture.partial]){await db.execute('DELETE FROM admin_catalog_tasks WHERE recitation_id=?',[id]);await db.execute('DELETE FROM recitation_voice_reviews WHERE recitation_id=?',[id]);}
  await db.execute("DELETE FROM human_review_items WHERE subject_type='audio_provider' AND subject_id=?",[manifest.fixture.provider]);
  for(const item of [...manifest.created].reverse()){assert.ok(['reciters','audio_providers','recitations','recitation_chapters','ayah_timings'].includes(item.table));await db.execute('DELETE FROM '+item.table+' WHERE id=?',[item.id]);}
  console.log(JSON.stringify({local_only:true,restored:true,immutable_audit_preserved:true}));await redis.quit();await pool.end();process.exit(0);
}
interface Identity{id:string;cookie:string;permissions:string[];roles:string[]}
const roles=['super_admin','admin','content_manager','moderator','support','finance','analyst'];
const identities=JSON.parse(await readFile(join(directory,'a1-browser-fixtures.json'),'utf8')) as Record<string,Identity>;
const created:Array<{table:string;id:string}>=[],settings=new Map<string,CatalogRow|null>(),riwayat=new Map<string,unknown>();
const ranks:Record<string,CatalogRow[]>={},checks:string[]=[],matrix:CatalogRow[]=[],plans:CatalogRow[]=[];
const prefix='a2a-http-'+randomUUID().slice(0,8),fixture={reader:randomUUID(),target:randomUUID(),provider:randomUUID(),primary:randomUUID(),secondary:randomUUID(),partial:randomUUID(),partialChapter:randomUUID(),chapter:randomUUID(),secondChapter:randomUUID(),task:randomUUID()};
let success=false,surah=0,riwayahCode='',original:CatalogRow={};
async function clearRates(){for(const key of await redis.keys('ayahx:admin-rate:*'))await redis.del(key);}
async function request(method:string,path:string,role?:string,body?:unknown){
  const headers:Record<string,string>={'Content-Type':'application/json',Origin:base.origin};
  if(role){assert.ok(identities[role]?.cookie,'PRIVATE_ROLE_COOKIE_REQUIRED');headers.Cookie='ayahx_admin_session='+encodeURIComponent(identities[role].cookie);}
  const response=await fetch(new URL(path,base),{method:method.toUpperCase(),headers,body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json() as {data:unknown;meta?:CatalogRow;code?:string};
  return {status:response.status,payload,id:response.headers.get('x-request-id'),cache:response.headers.get('cache-control')};
}
async function auditCount(id:string|null){assert.ok(id,'SERVER_REQUEST_ID_REQUIRED');const [row]=await db.read('SELECT COUNT(*) n FROM audit_logs WHERE request_id=?',[id]);return Number(row.n);}
async function write(role:string,method:string,path:string,body:unknown){await clearRates();const result=await request(method,path,role,body);assert.equal(result.status,200,`${role} ${method} ${path}: ${result.payload.code}`);assert.equal(await auditCount(result.id),1,'EXACT_ONE_HTTP_OPERATION_AUDIT');const [audit]=await db.read('SELECT user_id,ip_address,old_values,new_values FROM audit_logs WHERE request_id=?',[result.id]);assert.equal(audit.user_id,identities[role].id);assert.ok(audit.ip_address);return result.payload.data as CatalogRow;}
async function get(path:string){const result=await request('get',path);assert.equal(result.status,200,`PUBLIC_WIRING ${path} ${result.payload.code}`);return result.payload.data as CatalogRow[];}
async function backupSetting(key:string){if(!settings.has(key)){const [row]=await db.read('SELECT key_name,value_text,is_secret,category FROM system_settings WHERE key_name=?',[key]);settings.set(key,row??null);}}
async function seedSetting(key:string,value:string){await backupSetting(key);await db.execute("INSERT INTO system_settings(key_name,value_text,is_secret,category) VALUES(?,?,0,'quran_catalog') ON DUPLICATE KEY UPDATE value_text=VALUES(value_text)",[key,value]);}
async function setSetting(key:string,value:string|boolean){await backupSetting(key);await write('super_admin','patch','/api/admin/settings/'+key,{value});}
async function clone(table:string,id:string,newId:string,overrides:CatalogRow){assert.ok(['reciters','audio_providers','recitations','recitation_chapters','ayah_timings'].includes(table));const [columns]=await pool.query<RowDataPacket[]>('SHOW COLUMNS FROM '+table);const names=columns.filter(c=>!/GENERATED/iu.test(String(c.Extra))).map(c=>String(c.Field));for(const name of names)assert.match(name,/^[a-z_][a-z0-9_]*$/u);await db.execute('INSERT INTO '+table+'('+names.join(',')+') SELECT '+names.map(name=>name==='id'||Object.hasOwn(overrides,name)?'?':name).join(',')+' FROM '+table+' WHERE id=?',[...names.flatMap(name=>name==='id'?[newId]:Object.hasOwn(overrides,name)?[overrides[name]]:[]),id]);created.push({table,id:newId});}
async function resetClones(){
  await db.execute('UPDATE reciters SET is_visible=1,is_featured=0 WHERE id IN (?,?)',[fixture.reader,fixture.target]);
  await db.execute("UPDATE audio_providers SET license_status='permitted',attribution_text=NULL WHERE id=?",[fixture.provider]);
  await db.execute("UPDATE recitations SET reciter_id=?,is_public=1,is_default_for_reciter=0,voice_identity_status='confirmed',voice_notes='LOCAL_FIXTURE_ONLY_NOT_HUMAN_VOICE_APPROVAL',attribution_text=NULL WHERE id IN (?,?)",[fixture.reader,fixture.primary,fixture.secondary]);
  await db.execute('UPDATE recitation_chapters SET is_enabled=1 WHERE recitation_id IN (?,?)',[fixture.primary,fixture.secondary]);
  await db.execute('UPDATE riwayat SET is_active=1 WHERE code=?',[riwayahCode]);
}
const definitions:AdminEndpointDefinition[]=[];
// Registration is declarative; handlers are invoked only through the live HTTP router.
registerCatalogAdminEndpoints(definition=>definitions.push(definition),{} as Parameters<typeof registerCatalogAdminEndpoints>[1]);
function concrete(def:AdminEndpointDefinition){let path=def.path;const id=path.includes('/reciters/')?fixture.reader:path.includes('/providers/')?fixture.provider:path.includes('/sources/')?fixture.chapter:path.includes('/tasks/')?fixture.task:path.includes('/move')?fixture.secondary:fixture.primary;path=path.replace(':id',id).replace(':surah',String(surah)).replace(':code',riwayahCode);if(path==='/catalog/timings')path+=`?recitation_id=${fixture.primary}&surah=${surah}&from=1&to=100`;return '/api/admin'+path;}
async function payload(def:AdminEndpointDefinition):Promise<CatalogRow>{const path=def.path;
  if(path.endsWith('/profile'))return {name_ar:'اسم اختبار HTTP محلي',bio:'LOCAL_FIXTURE_ONLY',is_featured:false};
  if(path==='/catalog/reciters/visibility')return {ids:[fixture.reader,fixture.target],is_visible:true};
  if(path.includes('reciters')&&path.endsWith('/visibility'))return {is_visible:true};
  if(path.endsWith('/reorder'))return {ordered_ids:path.includes('reciters')?[fixture.target,fixture.reader]:[fixture.secondary,fixture.primary]};
  if(path.endsWith('/merge')){const rows=await db.read('SELECT id FROM recitations WHERE reciter_id=? ORDER BY id',[fixture.reader]);return {target_id:fixture.target,recitation_map:rows.map(row=>({recitation_id:row.id,target_reciter_id:fixture.target})),reason:'LOCAL_FIXTURE_ONLY explicit merge',confirmation:prefix+'-reader'};}
  if(path.endsWith('/presentation'))return {display_label_ar:'تسمية HTTP محلية',display_label_en:'Local HTTP label',quality_note:'LOCAL_FIXTURE_ONLY'};
  if(path.endsWith('/visibility'))return {is_public:true};
  if(path.endsWith('/default'))return {};
  if(path.endsWith('/move'))return {reciter_id:fixture.target,reason:'LOCAL_FIXTURE_ONLY move',confirmation:prefix+'-secondary'};
  if(path.endsWith('/recalculate')||path.endsWith('/check-links'))return {intent_id:randomUUID()};
  if(path.endsWith('/active'))return {kind:'chapter',is_active:true};
  if(path.endsWith('/license'))return {license_status:'permitted',notes:'LOCAL_FIXTURE_ONLY: not legal approval of the original provider',rights_evidence_ref:'local-fixture-only',confirmation:prefix};
  if(path.includes('/riwayat/'))return {is_active:true,confirmation:riwayahCode};
  throw new Error('UNHANDLED_ENDPOINT_PAYLOAD '+path);
}
async function cleanup(){
  for(const [key,row]of settings)if(row)await db.execute('UPDATE system_settings SET value_text=?,is_secret=?,category=? WHERE key_name=?',[row.value_text,row.is_secret,row.category,key]);else await db.execute('DELETE FROM system_settings WHERE key_name=?',[key]);
  for(const [id,value]of riwayat)await db.execute('UPDATE riwayat SET is_active=? WHERE id=?',[value,id]);
  for(const [table,rows]of Object.entries(ranks))for(const row of rows)await db.execute('UPDATE '+table+' SET sort_order=? WHERE id=?',[row.sort_order,row.id]);
  await db.execute('DELETE FROM admin_catalog_tasks WHERE recitation_id IN (?,?)',[fixture.primary,fixture.secondary]);await db.execute('DELETE FROM recitation_voice_reviews WHERE recitation_id IN (?,?)',[fixture.primary,fixture.secondary]);
  await db.execute("DELETE FROM human_review_items WHERE subject_type='audio_provider' AND subject_id=?",[fixture.provider]);
  for(const item of [...created].reverse())await db.execute('DELETE FROM '+item.table+' WHERE id=?',[item.id]);
}
try{
  const [version]=await db.read('SELECT VERSION() version');assert.equal(version.version,'9.7.2','MYSQL_9_7_2_REQUIRED');
  const before=await read.integrity(),protectedRoles=await db.read('SELECT user_id,role FROM user_roles ORDER BY user_id,role');assert.equal(before.matches,true);
  const [dataset]=await db.read('SELECT (SELECT COUNT(*) FROM recitations) recitations,(SELECT COUNT(*) FROM recitation_chapters) chapters,(SELECT COUNT(*) FROM ayah_timings) timings');
  for(const role of roles){await clearRates();const result=await request('get','/api/admin/auth/me',role);assert.equal(result.status,200);const user=result.payload.data as CatalogRow;identities[role].permissions=user.permissions as string[];identities[role].roles=user.roles as string[];assert.ok(identities[role].roles.includes(role));}
  [original]=await db.read("SELECT r.id,r.reciter_id,r.provider_id,r.riwayah_id,r.riwayah_code,c.id chapter_id,c.surah FROM recitations r JOIN recitation_chapters c ON c.recitation_id=r.id WHERE r.status='published' AND c.availability_state='complete' AND r.canonical_text_available=1 ORDER BY c.expected_ayahs,r.slug,c.surah LIMIT 1");assert.ok(original,'REAL_PUBLISHED_COMPLETE_SOURCE_REQUIRED');surah=Number(original.surah);riwayahCode=String(original.riwayah_code);
  const [rv]=await db.read('SELECT id,is_active FROM riwayat WHERE id=?',[original.riwayah_id]);riwayat.set(String(rv.id),rv.is_active);
  for(const table of ['reciters','recitations'])ranks[table]=await db.read('SELECT id,sort_order FROM '+table);
  for(const [name,id]of [['reader',fixture.reader],['target',fixture.target]])await clone('reciters',String(original.reciter_id),id,{slug:prefix+'-'+name,source_reciter_id:prefix+'-'+name,name_ar:'قارئ HTTP محلي '+name,name_en:'Local HTTP '+name,is_visible:1,is_featured:0});
  await clone('audio_providers',String(original.provider_id),fixture.provider,{code:prefix,name:'LOCAL_FIXTURE_ONLY provider',license_status:'permitted',attribution_text:null});
  for(const [name,id,chapter]of [['primary',fixture.primary,fixture.chapter],['secondary',fixture.secondary,fixture.secondChapter]]){
    await clone('recitations',String(original.id),id,{slug:prefix+'-'+name,reciter_id:fixture.reader,provider_id:fixture.provider,is_public:1,is_default_for_reciter:0,voice_identity_status:'confirmed',voice_notes:'LOCAL_FIXTURE_ONLY_NOT_HUMAN_VOICE_APPROVAL',attribution_text:null});
    await clone('recitation_chapters',String(original.chapter_id),chapter,{recitation_id:id,is_enabled:1});
    for(const row of await db.read('SELECT id FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah',[original.id,surah]))await clone('ayah_timings',String(row.id),randomUUID(),{recitation_id:id});
  }
  await seedSetting('quran_catalog_v2','true');await seedSetting('availability_mode','complete_only');await seedSetting('voice_gate_policy','require_confirmed');
  await clearRates();await write('super_admin','post','/api/admin/catalog/recitations/'+fixture.primary+'/recalculate',{intent_id:fixture.task});
  for(const def of definitions){await clearRates();const result=await request(def.method,concrete(def),undefined,def.method==='get'?undefined:await payload(def));assert.equal(result.status,401,def.path);assert.ok(result.cache?.includes('no-store'));assert.equal(await auditCount(result.id),0);}
  for(const role of roles){await clearRates();await resetClones();
    const ordered=[...definitions.filter(d=>d.method==='get'),...definitions.filter(d=>d.method!=='get'&&!d.path.endsWith('/merge')&&!d.path.endsWith('/move')),...definitions.filter(d=>d.path.endsWith('/move')),...definitions.filter(d=>d.path.endsWith('/merge'))];
    for(const def of ordered){const allowed=identities[role].permissions.includes(def.permission)&&(!def.superAdminOnly||identities[role].roles.includes('super_admin'));const path=concrete(def),body=def.method==='get'?undefined:await payload(def);let status:number;
      if(allowed&&def.method!=='get'){await write(role,def.method,path,body);status=200;}
      else{const result=await request(def.method,path,role,body);status=result.status;assert.equal(status,allowed?200:403,`${role} ${def.method} ${def.path}`);assert.equal(await auditCount(result.id),0);assert.ok(result.cache?.includes('no-store'));}
      matrix.push({role,method:def.method,path:def.path,permission:def.permission,status,allowed});
    }
  }
  checks.push('all_registered_endpoints_anonymous_401','seven_roles_all_endpoint_rbac','all_authorized_http_writes_exact_one_aggregate_audit');
  await clearRates();await resetClones();
  const readerPath='/api/catalog/reciters/'+prefix+'-reader/recitations',primaryPath='/api/admin/catalog/recitations/'+fixture.primary,publicPrimary='/api/catalog/recitations/'+prefix+'-primary';
  await write('super_admin','patch','/api/admin/catalog/reciters/'+fixture.reader+'/profile',{name_ar:'قارئ ربط HTTP',name_en:'HTTP wiring reader'});assert.ok((await get('/api/catalog/reciters')).some(r=>r.id===fixture.reader&&r.name_ar==='قارئ ربط HTTP'));
  await write('super_admin','patch',primaryPath+'/presentation',{display_label_ar:'تسمية ربط HTTP',display_label_en:'HTTP wiring label'});assert.equal((await get(readerPath)).find(r=>r.id===fixture.primary)?.display_label_ar,'تسمية ربط HTTP');
  await write('super_admin','post',primaryPath+'/default',{});assert.equal((await get(readerPath))[0].id,fixture.primary);await write('super_admin','post','/api/admin/catalog/recitations/'+fixture.secondary+'/default',{});assert.equal((await get(readerPath))[0].id,fixture.secondary);
  await db.execute('UPDATE recitations SET is_default_for_reciter=0 WHERE reciter_id=?',[fixture.reader]);
  const reorder=await write('super_admin','post','/api/admin/catalog/recitations/reorder',{ordered_ids:[fixture.secondary,fixture.primary]});assert.deepEqual((await get(readerPath)).map(r=>r.id),[fixture.secondary,fixture.primary]);await write('super_admin','post','/api/admin/catalog/recitations/reorder',{ordered_ids:reorder.previous_order});
  await write('super_admin','post','/api/admin/catalog/reciters/'+fixture.reader+'/visibility',{is_visible:false});assert.ok(!(await get('/api/catalog/reciters')).some(r=>r.id===fixture.reader));assert.equal((await request('get',publicPrimary+'/surahs')).status,404);await write('super_admin','post','/api/admin/catalog/reciters/'+fixture.reader+'/visibility',{is_visible:true});
  await write('super_admin','post','/api/admin/catalog/sources/'+fixture.chapter+'/active',{kind:'chapter',is_active:false});assert.equal((await request('get',publicPrimary+'/chapters/'+surah+'/availability')).status,409);await write('super_admin','post','/api/admin/catalog/sources/'+fixture.chapter+'/active',{kind:'chapter',is_active:true});
  await write('super_admin','patch','/api/admin/catalog/providers/'+fixture.provider+'/license',{license_status:'restricted',notes:'LOCAL_FIXTURE_ONLY restriction',confirmation:prefix});assert.ok(!(await get(readerPath)).some(r=>r.id===fixture.primary));await write('super_admin','patch','/api/admin/catalog/providers/'+fixture.provider+'/license',{license_status:'permitted',notes:'LOCAL_FIXTURE_ONLY not original legal approval',rights_evidence_ref:'local-fixture-only',confirmation:prefix});assert.ok((await get(readerPath)).some(r=>r.id===fixture.primary));
  await write('super_admin','patch','/api/admin/catalog/quran/riwayat/'+riwayahCode,{is_active:false,confirmation:riwayahCode});assert.equal((await request('get',publicPrimary+'/surahs')).status,404);await write('super_admin','patch','/api/admin/catalog/quran/riwayat/'+riwayahCode,{is_active:true,confirmation:riwayahCode});
  await db.execute("UPDATE recitations SET voice_identity_status='auto_verified',voice_notes='LOCAL_FIXTURE_ONLY_POLICY_TEST' WHERE id=?",[fixture.primary]);await setSetting('voice_gate_policy','require_confirmed');assert.ok(!(await get(readerPath)).some(r=>r.id===fixture.primary));await setSetting('voice_gate_policy','allow_auto_verified');assert.ok((await get(readerPath)).some(r=>r.id===fixture.primary));await db.execute("UPDATE recitations SET voice_identity_status='confirmed' WHERE id=?",[fixture.primary]);
  await setSetting('show_timing_badges',false);await setSetting('default_attribution_text','LOCAL_HTTP_ATTRIBUTION');const presentation=(await get(readerPath)).find(r=>r.id===fixture.primary);assert.equal(presentation?.timing_level,null);assert.equal(presentation?.show_timing_badges,false);assert.equal(presentation?.attribution_text,'LOCAL_HTTP_ATTRIBUTION');await setSetting('show_timing_badges',true);
  // Use an actual prepared partial chapter, not an invented timing or audio range.
  const [partial]=await db.read("SELECT c.id,c.surah,c.recitation_id FROM recitation_chapters c JOIN recitations r ON r.id=c.recitation_id WHERE c.availability_state IN ('partial','near_complete') AND c.run_count>0 AND c.audio_status='available' AND r.offset_verified=1 AND r.canonical_text_available=1 AND r.channel<>'youtube' AND c.recitation_id NOT IN (?,?) ORDER BY c.surah LIMIT 1",[fixture.primary,fixture.secondary]);assert.ok(partial,'REAL_PARTIAL_SOURCE_REQUIRED_FOR_AVAILABILITY_WIRING');
  const partialChapter=fixture.partialChapter;await clone('recitations',String(partial.recitation_id),fixture.partial,{slug:prefix+'-partial',reciter_id:fixture.reader,provider_id:fixture.provider,status:'published',is_public:1,is_default_for_reciter:0,voice_identity_status:'confirmed',voice_notes:'LOCAL_FIXTURE_ONLY_NOT_HUMAN_VOICE_APPROVAL',attribution_text:null});
  await clone('recitation_chapters',String(partial.id),partialChapter,{recitation_id:fixture.partial,is_enabled:1});
  for(const timing of await db.read('SELECT id FROM ayah_timings WHERE recitation_id=? AND surah=? ORDER BY ayah',[partial.recitation_id,partial.surah]))await clone('ayah_timings',String(timing.id),randomUUID(),{recitation_id:fixture.partial});
  const partialPath='/api/catalog/recitations/'+prefix+'-partial/surahs';await setSetting('availability_mode','complete_only');assert.ok(!(await get(partialPath)).some(r=>r.surah===Number(partial.surah)));await setSetting('availability_mode','ayah_ranges');assert.ok((await get(partialPath)).some(r=>r.surah===Number(partial.surah)));checks.push('actual_public_labels_default_order_visibility_source_riwayah_license_settings_voice_availability_consumers');
  await write('super_admin','post',primaryPath+'/move',{reciter_id:fixture.target,reason:'LOCAL_FIXTURE_ONLY move wiring',confirmation:prefix+'-primary'});const moved=(await request('get',primaryPath,'super_admin')).payload.data as CatalogRow;assert.equal(moved.reciter_id,fixture.target);assert.equal(moved.voice_identity_status,'unverified');assert.equal(Number(moved.is_public),0);assert.equal(Number(moved.is_default_for_reciter),0);assert.equal((await request('get',publicPrimary+'/surahs')).status,404);checks.push('move_resets_public_default_and_voice_gates');
  const queries=[{name:'recitation_reader',sql:'SELECT id FROM recitations WHERE reciter_id=? ORDER BY sort_order',params:[original.reciter_id]},{name:'chapter_recitation_surah',sql:'SELECT id FROM recitation_chapters WHERE recitation_id=? AND surah=?',params:[original.id,surah]},{name:'timing_recitation_surah_range',sql:'SELECT id FROM ayah_timings WHERE recitation_id=? AND surah=? AND ayah BETWEEN ? AND ? ORDER BY ayah',params:[original.id,surah,1,100]}];
  for(const query of queries){const explain=await db.read('EXPLAIN '+query.sql,query.params),elapsed:number[]=[];for(let n=0;n<5;n++){const start=performance.now();await db.read(query.sql,query.params);elapsed.push(performance.now()-start);}assert.ok(explain.some(row=>row.key),'ACTUAL_INDEX_REQUIRED '+query.name);if(query.name.startsWith('timing'))assert.ok(Math.max(...elapsed)<50,'TIMING_RANGE_UNDER_50_MS_REQUIRED');plans.push({name:query.name,keys:explain.map(row=>row.key),type:explain.map(row=>row.type),elapsed_ms:elapsed});}checks.push('actual_explain_and_timing_range_under_50_ms');
  const tasks=await db.read('SELECT id,status FROM admin_catalog_tasks WHERE recitation_id IN (?,?)',[fixture.primary,fixture.secondary]);assert.ok(tasks.every(task=>task.status==='pending'),'LOCAL_HARNESS_WORKER_MUST_BE_DISABLED_NO_EXTERNAL_HEAD');
  const after=await read.integrity();assert.deepEqual(after.counts,before.counts);assert.equal(after.stored_checksum,before.stored_checksum);assert.deepEqual(await db.read('SELECT user_id,role FROM user_roles ORDER BY user_id,role'),protectedRoles);checks.push('canonical_and_existing_admin_roles_unchanged');
  success=true;
  if(process.argv.includes('--keep-fixtures')){await resetClones();await db.execute("UPDATE recitations SET voice_identity_status='auto_verified',voice_notes='LOCAL_FIXTURE_ONLY_POLICY_TEST' WHERE id=?",[fixture.secondary]);const readerStates=await db.read('SELECT id,slug,name_ar,name_en FROM reciters WHERE id IN (?,?)',[fixture.reader,fixture.target]),recitationStates=await db.read('SELECT id,slug,reciter_id,display_label_ar,display_label_en,is_default_for_reciter,voice_identity_status,is_public FROM recitations WHERE id IN (?,?,?)',[fixture.primary,fixture.secondary,fixture.partial]),chapterStates=await db.read('SELECT c.id,c.recitation_id,c.surah,s.name_ar,s.ayah_count,c.availability_state FROM recitation_chapters c JOIN quran_surahs s ON s.number=c.surah WHERE c.recitation_id IN (?,?,?)',[fixture.primary,fixture.secondary,fixture.partial]);await setSetting('availability_mode','ayah_ranges');await setSetting('voice_gate_policy','require_confirmed');await mkdir(directory,{recursive:true});await writeFile(manifestFile,JSON.stringify({local_only:true,schema:mysqlAddress.pathname.slice(1),prefix,fixture,surah,partial_surah:Number(partial.surah),riwayah_code:riwayahCode,reciters:readerStates,recitations:recitationStates,provider:{id:fixture.provider,code:prefix},chapters:chapterStates,created,restore:{settings:[...settings.entries()],riwayat:[...riwayat.entries()],ranks},cleanup_command:'npx tsx scripts/a2a-http-acceptance.ts --allow-local-fixture-writes --cleanup',notes:'Clones only; voice/rights prerequisites are local test values, never human approval.'}),{mode:0o600});}
  console.log(JSON.stringify({local_only:true,checks,endpoint_count:definitions.length,role_count:roles.length,matrix,baseline_dataset:dataset,canonical_checksum:after.stored_checksum,index_plans:plans,kept_local_fixtures:process.argv.includes('--keep-fixtures'),network_source_checks:false}));
}finally{if(!success||!process.argv.includes('--keep-fixtures'))await cleanup();await redis.quit();await pool.end();}
