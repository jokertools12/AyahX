import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { d7RunBundle } from './lib/d7RailwayOperator';
const built=await build({entryPoints:['scripts/d7-close-public-flag.ts'],bundle:true,write:false,packages:'external',platform:'node',target:'node22',format:'cjs',logLevel:'silent'});
const raw=await d7RunBundle('app',Buffer.from(built.outputFiles[0].contents),['--root-operated']);
const line=raw.split(/\r?\n/u).findLast(row=>row.startsWith('{'));if(!line)throw new Error('FLAG_PROOF_REQUIRED');
const proof=JSON.parse(line);await writeFile('docs/data/d7-flag-close-proof.json',JSON.stringify({...proof,checked_at:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify(proof));
