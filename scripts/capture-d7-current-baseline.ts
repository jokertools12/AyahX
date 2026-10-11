import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve,relative,isAbsolute } from 'node:path';
import { captureInventory,ENVIRONMENTS } from './lib/railwayQuranOps';
const out=resolve(process.argv[2]),rel=relative(process.cwd(),out);assert.ok(rel.startsWith('..')||isAbsolute(rel),'PRIVATE_OUTPUT_REQUIRED');
const inventory=await captureInventory(ENVIRONMENTS.production);await writeFile(out,JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify({checked_at:inventory.checked_at,d1:inventory.d1_counts,d3:inventory.row_counts.ayah_timings,canonical_checksum:inventory.canonical_checksum,critical:inventory.critical_counts,tables:inventory.tables.length,production_writes:0}));
