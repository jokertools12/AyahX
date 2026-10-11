/** Root: transfer an ephemeral read-only audit to the existing Skia worker. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { d7RunBundle,D7OperatorError } from './lib/d7RailwayOperator';
const built=await build({entryPoints:['scripts/d7-font-audit.ts'],bundle:true,write:false,packages:'external',platform:'node',target:'node22',format:'cjs',logLevel:'silent'});
const raw=await d7RunBundle('skia',Buffer.from(built.outputFiles[0].contents)).catch(async error=>{
 if(error instanceof D7OperatorError){const progress=error.stdout.split(/\r?\n/u).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(row=>row.progress===true).map(row=>({raster_words:row.raster_words,batches:row.batches}));await writeFile('docs/data/d7-worker-font-failure.json',JSON.stringify({passed:false,error:error.message,diagnostic_sha256:error.diagnosticHash,safe_diagnostic:error.safeDiagnostic,progress,checked_at:new Date().toISOString()},null,2)+'\n');}
 throw error;
});
const line=raw.split(/\r?\n/u).findLast(line=>line.trim().startsWith('{'));assert.ok(line,'FONT_PROOF_JSON_REQUIRED');
const proof=JSON.parse(line);assert.equal(proof.platform,'linux');assert.equal(proof.sql_writes,0);
await writeFile('docs/data/d7-worker-font-proof.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({passed:proof.passed,platform:proof.platform,unique_words:proof.unique_words,fonts:proof.fonts.map((font:{family:string;missing:unknown[]})=>({family:font.family,missing:font.missing}))}));
if(!proof.passed)process.exitCode=1;
