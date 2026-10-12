/** Root: read active-job count before any worker-session recovery. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {d7RunBundle,D7OperatorError} from './lib/d7RailwayOperator';
const source=`(async()=>{const mysql=require('mysql2/promise');const e=process.env;const c=await mysql.createConnection({host:e.MYSQL_HOST,port:Number(e.MYSQL_PORT),user:e.MYSQL_USER,password:e.MYSQL_PASSWORD,database:e.MYSQL_DATABASE});try{const [r]=await c.query("SELECT COUNT(*) n FROM render_jobs WHERE status IN ('queued','running')");console.log(JSON.stringify({active_jobs:Number(r[0].n),sql_writes:0}));}finally{await c.end();}})().catch(()=>{console.error('D7_ACTIVE_JOB_READ_FAILED');process.exitCode=1;});`;
const parse=(raw:string)=>{const line=raw.split(/\r?\n/u).findLast(line=>line.startsWith('{'));assert.ok(line);return JSON.parse(line);};
const app=parse(await d7RunBundle('app',Buffer.from(source)));assert.equal(app.active_jobs,0,'WORKER_MUST_BE_IDLE');
let skia;
try{skia=parse(await d7RunBundle('skia',Buffer.from('console.log(JSON.stringify({probe:true,sql_writes:0}));')));}
catch(error){if(!(error instanceof D7OperatorError))throw error;skia={probe:false,diagnostic:error.safeDiagnostic,hash:error.diagnosticHash};}
const proof={checked_at:new Date().toISOString(),app,skia,transport:'single_ssh_stdin_gzip_sha256'};
await writeFile('docs/data/d7-ssh-recovery-proof.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
