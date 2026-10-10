/** Destructive proof restricted to explicit private local MySQL databases. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { downQuranTimingTables, TIMING_TABLES, timingChapterColumns } from '../server/db/migrations/003_addQuranTimingTables';
import { timingColumns } from '../server/services/qudTimingSql';
import { chapterTimingVerificationQueries, reconcileChapterTimingCoverage } from '../server/services/qudTimingVerification';
const option = (name: string): string => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error('REQUIRED_OPTION:' + name); return process.argv[i + 1]; };
const database = option('--local-db'), killedDatabase = option('--kill-db');
for (const name of [database,killedDatabase]) assert.match(name, /^ayahx_d2_[a-z0-9_]+$/u, 'PRIVATE_REHEARSAL_ONLY');
const connection = (name: string) => mysql.createConnection({ host: '127.0.0.1', port: 33319, user: 'root', database: name, charset: 'utf8mb4', multipleStatements: true });
const db = await connection(database); const killedDb = await connection(killedDatabase);
const preparation = JSON.parse(readFileSync(option('--manifest'), 'utf8')) as { results: Array<{slug: string; rows: number}> };
const resumeAfterCorruption = process.argv.includes('--resume-after-corruption');
const report: Record<string, unknown> = resumeAfterCorruption ? JSON.parse(readFileSync(option('--report'),'utf8')) : { checked_at: new Date().toISOString(), mysql: '9.7.2', local_only: true, volatile_timestamps_excluded_from_semantic_hash: true };
const save = () => writeFileSync(option('--report'), JSON.stringify(report, null, 2) + '\n');
const argsFor = (name: string, tag: string, extra: string[] = []) => {
  const args = ['--import','tsx','scripts/import-qud-timings.ts','--target','local','--apply','--local-db',name,'--report','docs/data/' + tag + '.json','--sql',join(process.env.TEMP!, tag + '.sql'), ...extra];
  for (const key of ['--manifest','--corpus','--input-dir','--preflight']) args.push(key,option(key)); return args;
};
async function run(name: string, tag: string, extra: string[] = [], wanted = 0): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, argsFor(name,tag,extra), { stdio: ['ignore','pipe','pipe'] }); child.stdout.resume(); child.stderr.resume();
  const code = await new Promise<number | null>((accept,reject) => { child.once('error',reject); child.once('close',accept); }); assert.equal(code,wanted,'CLI_EXIT:' + tag);
  const result = JSON.parse(readFileSync('docs/data/' + tag + '.json','utf8')) as Record<string, unknown>; console.log(JSON.stringify({ stage: tag, exit_code: code, elapsed_ms: result.elapsed_ms })); return result;
}
async function fingerprint(c: Awaited<ReturnType<typeof connection>>): Promise<Record<string,string>> {
  const definitions: Record<string,string[]> = {
    ayah_timings: [...timingColumns], import_jobs: ['id','recitation_id','qud_version','source_sha256','manifest_sha256','canonical_checksum','importer_version','status','checkpoint','total_rows','imported_rows','review_rows','error_json'],
    ayah_timing_history: ['id','timing_id','version_hash','snapshot','reason'], recitation_chapters: ['id','recitation_id','surah','coverage_words','expected_words','coverage_details','timing_complete','is_complete'], recitations: ['id','coverage_words'],
  };
  const output: Record<string,string> = {};
  for (const [table,keys] of Object.entries(definitions)) {
    const fields = keys.flatMap((key) => ["'" + key + "'",key]).join(',');
    const [rows] = await c.query<RowDataPacket[]>("SELECT SHA2(CAST(JSON_OBJECT(" + fields + ") AS CHAR CHARACTER SET utf8mb4),256) row_hash FROM " + table + ' ORDER BY id');
    const hash = createHash('sha256'); for (const row of rows) hash.update(String(row.row_hash) + '\n'); output[table] = hash.digest('hex');
  }
  return output;
}
try {
  const [identity] = await db.query<RowDataPacket[]>('SELECT VERSION() v, DATABASE() d'); assert.equal(identity[0].v,'9.7.2'); assert.equal(identity[0].d,database);
  const initial = JSON.parse(readFileSync(option('--first-report'),'utf8')) as {completed: boolean;results: Array<{slug: string;rows: number}>}; assert.equal(initial.completed,true);
  assert.equal(initial.results.reduce((n,r)=>n+r.rows,0),preparation.results.reduce((n,r)=>n+r.rows,0));
  const baseline = resumeAfterCorruption ? report.uninterrupted as Record<string,string> : await fingerprint(db);
  if (resumeAfterCorruption) {
    assert.equal((report.idempotent_twice as {passed:boolean}).passed,true);
    assert.equal((report.kill_resume as {passed:boolean}).passed,true);
    assert.equal((report.corruption as {passed:boolean}).passed,true);
    assert.deepEqual(await fingerprint(killedDb),baseline,'RESUME_PROOF_BASELINE');
    report.rehearsal_resume_reason='A newly added verification guard incorrectly counted null unmapped spoken IDs as covered legal words. Fixed without changing prepared values.';
  } else {
  report.uninterrupted = baseline; save();
  const second = await run(database,'d3-close-cli-second'); assert.ok((second.results as Array<{rows:number;resumed_from:number}>).every((r)=>r.rows===r.resumed_from));
  assert.deepEqual(await fingerprint(db),baseline,'IDEMPOTENT_FINGERPRINT'); report.idempotent_twice = { passed:true, checkpoints_verified_and_skipped: preparation.results.length }; save();
  const child = spawn(process.execPath,argsFor(killedDatabase,'d3-close-cli-kill',['--pause-after-first-batch']),{stdio:['ignore','pipe','pipe']});child.stdout.resume();child.stderr.resume();
  const closed = new Promise<{code:number|null;signal:NodeJS.Signals|null}>((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});
  const marker = join(process.env.TEMP!,'ayahx-d3-kill-probe.json'); const until = Date.now()+600000;let checkpoint: {pid:number;checkpoint:number;slug:string}|undefined;
  while(Date.now()<until){if(existsSync(marker)){const value=JSON.parse(readFileSync(marker,'utf8'));if(value.pid===child.pid){checkpoint=value;break;}}await new Promise<void>(r=>setTimeout(r,250));}
  if(!checkpoint){child.kill('SIGKILL');await closed;throw new Error('KILL_CHECKPOINT_NOT_REACHED');}
  assert.ok(checkpoint.checkpoint>0&&checkpoint.checkpoint<preparation.results.find(r=>r.slug===checkpoint!.slug)!.rows);
  assert.equal(child.kill('SIGKILL'),true);const exit = await closed;
  const [part] = await killedDb.query<RowDataPacket[]>('SELECT COUNT(*) count FROM ayah_timings');assert.equal(Number(part[0].count),checkpoint.checkpoint);
  report.real_termination = {checkpoint,exit,windows_termination:'ChildProcess.kill(SIGKILL): native TerminateProcess',rows_after_kill:Number(part[0].count)};save();
  const resumed=await run(killedDatabase,'d3-close-cli-resumed');assert.equal((resumed.results as Array<{resumed_from:number}>)[0].resumed_from,checkpoint.checkpoint);
  assert.deepEqual(await fingerprint(killedDb),baseline,'KILL_RESUME_FINGERPRINT');report.kill_resume={passed:true,final_hashes:await fingerprint(killedDb)};save();
  const slug=preparation.results[0].slug;
  const [victims]=await db.query<RowDataPacket[]>('SELECT t.id,t.end_ms FROM ayah_timings t JOIN recitations r ON r.id=t.recitation_id WHERE r.slug=? AND t.end_ms IS NOT NULL LIMIT 1',[slug]);const victim=victims[0];
  await db.query('UPDATE ayah_timings SET end_ms=end_ms+1 WHERE id=?',[victim.id]);
  const failed=await run(database,'d3-close-cli-corruption',['--one',slug],1);assert.match(String(failed.failure),/^STORED_TIMING_MISMATCH:/u);
  const [history]=await db.query<RowDataPacket[]>("SELECT reason,JSON_EXTRACT(snapshot,'$.end_ms') captured_end FROM ayah_timing_history WHERE timing_id=?",[victim.id]);assert.equal(history.length,1);assert.equal(history[0].reason,'CHECKPOINT_STORED_VALUE_MISMATCH');assert.equal(Number(history[0].captured_end),Number(victim.end_ms)+1);
  const [still]=await db.query<RowDataPacket[]>('SELECT end_ms FROM ayah_timings WHERE id=?',[victim.id]);assert.equal(Number(still[0].end_ms),Number(victim.end_ms)+1);
  report.corruption={passed:true,cli_failed:true,silent_repair:false,history_rows:history.length,timing_id:victim.id};save();
  await db.query('UPDATE ayah_timings SET end_ms=? WHERE id=?',[victim.end_ms,victim.id]);await run(database,'d3-close-cli-corruption-restored',['--one',slug]);
  }
  if (resumeAfterCorruption) await run(database,'d3-close-cli-corruption-restored',['--one',preparation.results[0].slug]);
  await downQuranTimingTables(db,'local-rehearsal');
  const [remaining]=await db.query<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?)',[database,...TIMING_TABLES]);assert.equal(remaining.length,0);
  const [columns]=await db.query<RowDataPacket[]>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='recitation_chapters' AND COLUMN_NAME IN (?,?,?)",[database,...Object.keys(timingChapterColumns)]);assert.equal(columns.length,0);
  report.down={passed:true,dropped_tables:[...TIMING_TABLES],dropped_columns:Object.keys(timingChapterColumns)};save();
  const reapplied=await run(database,'d3-close-cli-reapplied');assert.deepEqual(await fingerprint(db),baseline,'DOWN_REAPPLY_FINGERPRINT');report.reapply={passed:true,sql_sha256:reapplied.sql_sha256};save();
  const [reciters]=await db.query<RowDataPacket[]>('SELECT id FROM recitations WHERE slug=?',['maher_al_muaiqly_qdc']);const id=reciters[0].id;
  const [explain]=await db.query<RowDataPacket[]>('EXPLAIN FORMAT=JSON SELECT * FROM ayah_timings WHERE recitation_id=? AND surah=2 AND ayah BETWEEN 1 AND 20',[id]);const plan=JSON.parse(explain[0].EXPLAIN);assert.match(JSON.stringify(plan),/uk_timing_ayah/u);
  const started=performance.now();const [found]=await db.query<RowDataPacket[]>('SELECT * FROM ayah_timings WHERE recitation_id=? AND surah=2 AND ayah BETWEEN 1 AND 20',[id]);const elapsed=performance.now()-started;assert.equal(found.length,20);assert.ok(elapsed<50,'INDEX_LATENCY');report.index={passed:true,plan,rows:found.length,elapsed_ms:elapsed};
  const [totals]=await db.query<RowDataPacket[]>('SELECT COUNT(*) count,SUM(expected_words IS NOT NULL AND coverage_words+JSON_LENGTH(missing_words)<>expected_words) violations FROM ayah_timings');assert.equal(Number(totals[0].count),preparation.results.reduce((n,r)=>n+r.rows,0));assert.equal(Number(totals[0].violations),0);
  const [counts]=await db.query<RowDataPacket[]>('SELECT r.slug,COUNT(*) count FROM ayah_timings t JOIN recitations r ON r.id=t.recitation_id GROUP BY r.slug');for(const expected of preparation.results)assert.equal(Number(counts.find(r=>r.slug===expected.slug)?.count),expected.rows);
  const aggregates: Array<Array<Record<string,unknown>>> = []; for (const query of chapterTimingVerificationQueries) { const [values]=await db.query<RowDataPacket[]>(query); aggregates.push(values.map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record)); } const chapterValues=reconcileChapterTimingCoverage(aggregates[0],aggregates[1],aggregates[2]);assert.equal(Number(chapterValues.coverage_errors),0,'CHAPTER_COVERAGE_INVARIANT');
  report.acceptance_counts={passed:true,total:Number(totals[0].count),word_accounting_violations:0,chapter_coverage_violations:Number(chapterValues.coverage_errors),recitations:counts};report.passed=true;save();
} finally {await db.end();await killedDb.end();save();}
