/** Explicit cleanup of one newly-created, terminal D7 lab job. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { d7RunBundle } from './lib/d7RailwayOperator';
const id=process.argv[2];assert.match(id,/^[a-f0-9-]{36}$/u);
const bundle=await build({entryPoints:['scripts/d7-job-artifact.ts'],bundle:true,write:false,packages:'external',platform:'node',target:'node22',format:'cjs',logLevel:'silent'});
const raw=await d7RunBundle('skia',Buffer.from(bundle.outputFiles[0].contents),['cleanup',id,'--root-operated']);
const line=raw.split(/\r?\n/u).findLast(line=>line.startsWith('{'));assert.ok(line);
const proof=JSON.parse(line);assert.equal(proof.artifact_removed,true);
await writeFile('docs/data/d7-first-failed-job-cleanup.json',JSON.stringify({...proof,checked_at:new Date().toISOString()},null,2)+'\n');
console.log(JSON.stringify(proof));
