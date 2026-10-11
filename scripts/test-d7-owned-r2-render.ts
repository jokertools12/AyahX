/** Root: real restored MySQL + owned R2 object + Skia/FFmpeg; no catalog SQL writes. */
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { catalogDatabaseFromPool } from '../server/services/catalogMysqlDatabase';
import { createOwnedRenderLabFixture } from '../server/services/renderLabOwnedFixture';
import { renderCatalogV2Video } from '../server/services/renderV2Executor';
const credentials=JSON.parse(await readFile(process.env.LOCALAPPDATA+'/AyahX/private-backups/r2-d4-credentials.json','utf8'));
const scope=credentials.production;assert.equal(scope.bucket,'ayahx-audio-prod');
Object.assign(process.env,{R2_ACCOUNT_ID:credentials.accountId,R2_ENDPOINT:credentials.endpoint,R2_BUCKET:scope.bucket,R2_ACCESS_KEY_ID:scope.writer.accessKeyId,R2_SECRET_ACCESS_KEY:scope.writer.secretAccessKey,R2_READ_ACCESS_KEY_ID:scope.reader.accessKeyId,R2_READ_SECRET_ACCESS_KEY:scope.reader.secretAccessKey});
const pool=mysql.createPool({host:'127.0.0.1',port:33319,user:'root',database:'ayahx_d2_d7_restored_20261011',connectionLimit:1});
const directory=process.env.LOCALAPPDATA+'/AyahX/d7-owned-r2-qa';await mkdir(directory,{recursive:true});
let fixture:Awaited<ReturnType<typeof createOwnedRenderLabFixture>>|undefined;
try{fixture=await createOwnedRenderLabFixture(catalogDatabaseFromPool(pool));const result=await renderCatalogV2Video({manifest:fixture.manifest,outputPath:path.join(directory,'owned-r2.mp4')});await writeFile('docs/data/d7-owned-r2-local-proof.json',JSON.stringify({passed:result.qaReport.passed,fixture:'OWNED_NOISE_QA_NOT_QURAN_TIMING',canonical_source:'restored_mysql',canonical_or_timing_sql_writes:0,qa:result.qaReport},null,2)+'\n');console.log(JSON.stringify({passed:result.qaReport.passed,fixture:'OWNED_NOISE_QA_NOT_QURAN_TIMING',ncc:result.qaReport.audio_correlation.score}));}
finally{if(fixture)await fixture.cleanup();await pool.end();}
