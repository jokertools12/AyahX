import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { chapterTimingVerificationQueries, reconcileChapterTimingCoverage, timingRecitationSummarySql, timingReviewReasonsSql } from '../server/services/qudTimingVerification';
const option=(name:string):string=>{const index=process.argv.indexOf(name);if(index<0||!process.argv[index+1])throw new Error('REQUIRED_OPTION:'+name);return process.argv[index+1];};
const database=option('--local-db');assert.match(database,/^ayahx_d2_[a-z0-9_]+$/u);
const db=await mysql.createConnection({host:'127.0.0.1',port:33319,user:'root',database});
try {
  const [identity]=await db.query<RowDataPacket[]>('SELECT VERSION() v');assert.equal(identity[0].v,'9.7.2');
  const started=performance.now();const aggregates:Array<Array<Record<string,unknown>>>=[];
  for(const query of chapterTimingVerificationQueries){const [rows]=await db.query<RowDataPacket[]>(query);aggregates.push(rows.map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record));}
  const result=reconcileChapterTimingCoverage(aggregates[0],aggregates[1],aggregates[2]);assert.equal(result.coverage_errors,0);
  const extra:Record<string,unknown>={};
  for(const [name,query] of [['recitations',timingRecitationSummarySql],['reasons',timingReviewReasonsSql]]) { const began=performance.now();const [rows]=await db.query<RowDataPacket[]>(query);extra[name]={elapsed_ms:performance.now()-began,rows:rows.map(r=>typeof r.record==='string'?JSON.parse(r.record):r.record)}; }
  const report={checked_at:new Date().toISOString(),mysql:'9.7.2',local_only:true,...result,elapsed_ms:performance.now()-started,...extra,passed:true};
  writeFileSync(option('--out'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {await db.end();}
