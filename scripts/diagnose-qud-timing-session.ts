/** Read-only diagnosis of an interrupted timing session; never kills unknown connections. */
import { readFileSync, writeFileSync } from 'node:fs';
import { openRailwayMysqlSession } from './lib/railwayMysqlSession';
import { ENVIRONMENTS } from './lib/railwayQuranOps';
import { loadPreparedTimings, storedTimingSql, verifyImportedRows, type PreparationManifest } from '../server/services/qudTimingImport';
const option=(name:string):string=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[i+1];};
const manifest=JSON.parse(readFileSync(option('--manifest'),'utf8')) as PreparationManifest;
const input=manifest.results.find(r=>r.slug===option('--slug'));if(!input)throw new Error('PINNED_RECITATION_REQUIRED');
const expected=loadPreparedTimings(option('--input-dir'),input);
const session=await openRailwayMysqlSession(ENVIRONMENTS.production);
const records=async(sql:string)=>(await session.read(sql)).trim().split('\n').filter(Boolean).map(s=>JSON.parse(s) as Record<string,unknown>);
const report:Record<string,unknown>={checked_at:new Date().toISOString(),read_only:true,slug:input.slug};
try {
  report.connections=await records("SELECT JSON_OBJECT('id',ID,'command',COMMAND,'seconds',TIME,'state',STATE,'query_sha256',IF(INFO IS NULL,NULL,SHA2(INFO,256))) AS record FROM information_schema.PROCESSLIST;");
  report.threads_connected=await session.read("SHOW STATUS LIKE 'Threads_connected';");
  report.max_connections=await session.read("SHOW VARIABLES LIKE 'max_connections';");
  report.jobs=await records("SELECT JSON_OBJECT('slug',r.slug,'checkpoint',j.checkpoint,'total_rows',j.total_rows,'status',j.status) AS record FROM import_jobs j JOIN recitations r ON r.id=j.recitation_id ORDER BY r.slug;");
  const started=performance.now();const actual=await records(storedTimingSql(expected[0].recitation_id)+';');report.read_ms=performance.now()-started;
  report.sha256=verifyImportedRows(expected,actual);report.rows=actual.length;report.passed=true;
} catch(error){report.failure=error instanceof Error?error.message:'READ_DIAGNOSIS_FAILED';process.exitCode=1;}
finally {try{report.serial=await session.close();}catch(error){report.failure??=error instanceof Error?error.message:'CLOSE_FAILED';process.exitCode=1;}writeFileSync(option('--out'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({slug:report.slug,rows:report.rows,read_ms:report.read_ms,passed:report.passed,failure:report.failure}));}
