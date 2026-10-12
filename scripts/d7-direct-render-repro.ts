/** Root-only Linux diagnosis: SELECT an existing new lab manifest, no SQL writes. */
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pool } from '../server/db';
import { renderCatalogV2Video } from '../server/services/renderV2Executor';
import { RenderV2QaError } from '../server/services/renderV2Qa';
async function main(){
 assert.ok(process.argv.includes('--root-operated'));
 const id=process.argv[2];assert.match(id,/^[a-f0-9-]{36}$/u);
 const [rows]=await pool.query("SELECT manifest FROM render_jobs WHERE id=? AND created_at>='2026-10-11 21:00:00'",[id]);
 assert.ok(Array.isArray(rows)&&rows.length===1);
 const raw=(rows[0] as {manifest:unknown}).manifest,manifest=typeof raw==='string'?JSON.parse(raw):raw;
 if(process.argv.includes('--fps60'))manifest.options.fps=60;
 const directory=await mkdtemp(path.join(os.tmpdir(),'ayahx-d7-linux-repro-'));
 try{const result=await renderCatalogV2Video({manifest,outputPath:path.join(directory,'repro.mp4')});console.log(JSON.stringify({passed:result.qaReport.passed,qa:result.qaReport,sql_writes:0,platform:process.platform}));}
 catch(error){if(error instanceof RenderV2QaError)console.log(JSON.stringify({passed:false,qa:error.qaReport,sql_writes:0,platform:process.platform}));else throw error;}
 finally{await rm(directory,{recursive:true,force:true});}
}
void main().catch(()=>{console.error('D7_DIRECT_REPRO_FAILED');process.exitCode=1;}).finally(()=>pool.end());
