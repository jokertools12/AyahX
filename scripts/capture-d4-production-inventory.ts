/** Root-owned single-session read-only snapshot for verified backups and D4 guards. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {captureInventory,ENVIRONMENTS} from './lib/railwayQuranOps';
import {openRailwayMysqlSession} from './lib/railwayMysqlSession';
const option=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw new Error('REQUIRED_OPTION:'+key);return process.argv[i+1];};
assert.equal(option('--target'),'production');const out=resolve(option('--out'));const outside=relative(process.cwd(),out);assert.ok(outside.startsWith('..')||isAbsolute(outside),'PRIVATE_INVENTORY_REQUIRED');
const session=await openRailwayMysqlSession(ENVIRONMENTS.production,{allowWrites:false});
try{
  const inventory=await captureInventory(ENVIRONMENTS.production,sql=>session.read(sql));
  assert.deepEqual(inventory.d1_counts,{surahs:114,ayahs:6236,words:77433});assert.equal(inventory.row_counts.ayah_timings,422463);
  assert.equal(inventory.canonical_checksum,'eca6ed31262dff3f8013160766e185c5331ef12efff3bc8989448383d40e4fe4');
  const disk=await session.storage();writeFileSync(out,JSON.stringify({...inventory,disk},null,2)+'\n');
  console.log(JSON.stringify({mysql:inventory.mysql_version,tables:inventory.tables.length,d1:inventory.d1_counts,d3:inventory.row_counts.ayah_timings,disk}));
}finally{await session.close();}
