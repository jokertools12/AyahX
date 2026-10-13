/** Root-operated local Skia consumer. No historical-job recovery or production config. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hostname} from 'node:os';
import mysql from 'mysql2/promise';

const schema=process.env.AYAHX_ADMIN_LOCAL_SCHEMA;
assert.ok(schema&&/^ayahx_d2_batch5_[a-z0-9_]+$/.test(schema),'BATCH5_LOCAL_SCHEMA_REQUIRED');
const privateDir=join(process.env.LOCALAPPDATA!,'AyahX','private-backups');
const secret=JSON.parse(await readFile(join(privateDir,'batch5-local-admin-runtime.json'),'utf8'));
Object.assign(process.env,{NODE_ENV:'test',JWT_SECRET:secret.jwt,ADMIN_2FA_ENC_KEY:secret.totp,MYSQL_HOST:'127.0.0.1',MYSQL_PORT:'33319',MYSQL_USER:'root',MYSQL_PASSWORD:'',MYSQL_DATABASE:schema,MYSQL_POOL_SIZE:'4',REDIS_URL:'redis://127.0.0.1:6380/15',OBJECT_STORAGE_DRIVER:'local',RENDER_QUEUE_DRIVER:'bullmq',RENDER_WORKER_ENGINE:'skia_canvas',SKIA_RENDER_MAX_CONCURRENCY:'1',RENDER_BACKGROUND_MAINTENANCE:'false'});
if(process.env.AYAHX_ADMIN_LOCAL_R2==='staging'){
 const file=JSON.parse(await readFile(join(privateDir,'r2-d4-credentials.json'),'utf8')),target=file.staging;
 assert.equal(target.bucket,'ayahx-audio-staging');
 Object.assign(process.env,{R2_BUCKET:target.bucket,R2_ENDPOINT:file.endpoint,R2_ACCOUNT_ID:file.accountId,R2_ACCESS_KEY_ID:target.writer.accessKeyId,R2_SECRET_ACCESS_KEY:target.writer.secretAccessKey,R2_READ_ACCESS_KEY_ID:target.reader.accessKeyId,R2_READ_SECRET_ACCESS_KEY:target.reader.secretAccessKey});
}
const connection=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database:schema});
try{const [rows]=await connection.query<mysql.RowDataPacket[]>('SELECT VERSION() version,@@hostname hostname');assert.equal(rows[0].version,'9.7.2');assert.equal(String(rows[0].hostname).toLowerCase(),hostname().toLowerCase());}finally{await connection.end();}
const {startDedicatedRenderWorker,renderJobQueue}=await import('../server/services/renderJobQueue');
const {closePool}=await import('../server/db');
const worker=startDedicatedRenderWorker();assert.ok(worker,'LOCAL_BULLMQ_WORKER_REQUIRED');
console.log(JSON.stringify({local_only:true,engine:'skia_canvas',redis_database:15,historical_recovery:false}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await worker!.close();renderJobQueue.shutdown();await closePool();process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
