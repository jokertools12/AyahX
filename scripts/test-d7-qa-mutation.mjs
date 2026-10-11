/** Review experiment: removing the audio duration guard must make its regression test fail. */
import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const file='server/services/renderV2Qa.ts',original=readFileSync(file,'utf8');
const condition='durationDifferenceMs <= durationToleranceMs + .001';assert.ok(original.includes(condition));
let result;
try{writeFileSync(file,original.replace(condition,'true'));result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/renderV2Worker.test.ts','-t','rejects a perfectly correlated prefix'],{encoding:'utf8',maxBuffer:1_000_000});assert.equal(result.status,1);assert.match(result.stdout+result.stderr,/1 failed/u);}
finally{writeFileSync(file,original);}
writeFileSync('docs/data/d7-qa-mutation-proof.json',JSON.stringify({passed:true,mutation:'remove decoded-audio duration guard',expected_failed_tests:1,actual_exit_code:result.status,source_restored:readFileSync(file,'utf8')===original,checked_at:new Date().toISOString()},null,2)+'\n');
console.log('QA_MUTATION_CAUGHT_AND_RESTORED');
