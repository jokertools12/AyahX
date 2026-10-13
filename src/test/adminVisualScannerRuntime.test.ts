// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
describe('actual standalone scanner loader',()=>{
 it('survives tsx runtime keepNames and serializes without external helpers',()=>{
  const script="import('./tooling/e2e/helpers/loadAdminVisualScanner.mjs').then(async({loadAdminVisualScanner})=>{const fn=await loadAdminVisualScanner();const source=fn.toString();if(/__name/.test(source))throw Error('EXTERNAL_KEEP_NAMES_HELPER');const serialized=new Function('return ('+source+');')();if(typeof serialized!=='function')throw Error('NOT_FUNCTION');console.log('STANDALONE_SCANNER_OK');});";
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:resolve('.'),encoding:'utf8',timeout:30000});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout.trim()).toBe('STANDALONE_SCANNER_OK');
 });
});
