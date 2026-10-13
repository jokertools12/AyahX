/** Real local MySQL/Redis harness. Never imports server startup/background work. */
import express from 'express';
import mysql from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
const schema=process.env.AYAHX_ADMIN_LOCAL_SCHEMA??'ayahx_d2_a1_verified_20261011';
if(!/^ayahx_d2_(a1|batch5)_[a-z0-9_]+$/.test(schema))throw new Error('LOCAL_SCHEMA_REQUIRED');
const batch5=schema.startsWith('ayahx_d2_batch5_'),port=batch5?3005:3001;
const privateDir=join(process.env.LOCALAPPDATA??join(homedir(),'AppData','Local'),'AyahX','private-backups');await mkdir(privateDir,{recursive:true});
const privateFile=join(privateDir,batch5?'batch5-local-admin-runtime.json':'a1-local-admin-runtime.json');
let secret:{jwt:string;totp:string};try{secret=JSON.parse(await readFile(privateFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;secret={jwt:randomBytes(32).toString('base64'),totp:randomBytes(32).toString('base64')};await writeFile(privateFile,JSON.stringify(secret),{mode:0o600,flag:'wx'});}
const env:NodeJS.ProcessEnv={NODE_ENV:'test',JWT_SECRET:secret.jwt,ADMIN_2FA_ENC_KEY:secret.totp,REDIS_URL:`redis://127.0.0.1:6380/${batch5?15:10}`,STORAGE_VOLUME_BYTES:'5000000000'};
// Global render queue/database modules read config at import time. Pin every
// destination before importing that runtime; local QA cannot inherit Railway.
Object.assign(process.env,env,{MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'33319',MYSQL_USER:'root',MYSQL_PASSWORD:'',MYSQL_DATABASE:schema,MYSQL_POOL_SIZE:'4',OBJECT_STORAGE_DRIVER:'local',RENDER_QUEUE_DRIVER:'bullmq',RENDER_BACKGROUND_MAINTENANCE:'false'});
if(process.env.AYAHX_ADMIN_LOCAL_R2==='staging'){
  const credentials=JSON.parse(await readFile(join(privateDir,'r2-d4-credentials.json'),'utf8'));
  const target=credentials.staging;
  Object.assign(env,{R2_BUCKET:target.bucket,R2_ENDPOINT:credentials.endpoint,R2_ACCOUNT_ID:credentials.accountId,R2_ACCESS_KEY_ID:target.writer.accessKeyId,R2_SECRET_ACCESS_KEY:target.writer.secretAccessKey,R2_READ_ACCESS_KEY_ID:target.reader.accessKeyId,R2_READ_SECRET_ACCESS_KEY:target.reader.secretAccessKey});
  if(credentials.createdAt&&Number.isFinite(credentials.ttlDays))env.R2_TOKEN_EXPIRES_AT=new Date(Date.parse(credentials.createdAt)+credentials.ttlDays*86400000).toISOString();
  for(const key of ['R2_BUCKET','R2_ENDPOINT','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_READ_ACCESS_KEY_ID','R2_READ_SECRET_ACCESS_KEY'])if(!env[key])throw new Error('LOCAL_STAGING_R2_CREDENTIALS_REQUIRED');
  Object.assign(process.env,env);
}
const {createAdminRuntime}=await import('../server/admin/adminRuntime');
const {catalogDatabaseFromPool}=await import('../server/services/catalogMysqlDatabase');
const {RecitationCatalogService,readCatalogSettings}=await import('../server/services/recitationCatalogService');
const {RecitationAudioResolver}=await import('../server/services/recitationAudioResolver');
const {CatalogAudioSource}=await import('../server/services/catalogAudioSource');
const {createCatalogRouter}=await import('../server/routes/catalog');
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',password:'',database:schema,connectionLimit:4,timezone:'Z'});const [versions]=await pool.query<mysql.RowDataPacket[]>('SELECT VERSION() version');if(versions[0].version!=='9.7.2')throw new Error('MYSQL_VERSION_REQUIRED');
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'64kb'}));app.use((_req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'strict-origin-when-cross-origin'});next();});
const db=catalogDatabaseFromPool(pool),source=new CatalogAudioSource();
const settings=()=>readCatalogSettings(db);
const catalog=new RecitationCatalogService(db,settings,new RecitationAudioResolver(db,source,settings));
const runtime=createAdminRuntime({db,source,catalog,env,origins:['http://127.0.0.1:4188',`http://localhost:${port}`,`http://127.0.0.1:${port}`]});
app.use('/api/admin',runtime.router);
app.use('/api/catalog',createCatalogRouter(catalog));
app.get('/api/health/ready',async(_req,res)=>{await pool.query('SELECT 1');res.json({status:'ready',mysql:'9.7.2',localOnly:true});});
const staticRoot=batch5&&process.env.AYAHX_ADMIN_BASELINE_DIR?process.env.AYAHX_ADMIN_BASELINE_DIR:join(process.cwd(),'dist');
app.use(express.static(staticRoot));
app.get('/{*path}',(_req,res)=>res.sendFile(join(staticRoot,'index.html')));
const server=app.listen(port,'localhost',()=>console.log(JSON.stringify({local_only:true,mysql:'9.7.2',redis:'real:6380',port,schema,secrets_logged:false})));
if(process.env.AYAHX_ADMIN_LOCAL_TASKS==='true')runtime.start();
const close=()=>{void runtime.stopTasks().then(()=>server.close(()=>{void runtime.close().then(()=>pool.end()).then(()=>process.exit(0));}));};process.on('SIGTERM',close);process.on('SIGINT',close);
