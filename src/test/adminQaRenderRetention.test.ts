// @vitest-environment node
import {mkdtemp,writeFile,stat,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
vi.mock('../../server/db',()=>({query:vi.fn()}));
vi.mock('../../server/logger',()=>({logger:{info:vi.fn(),warn:vi.fn(),error:vi.fn()}}));
vi.mock('../../server/services/objectStorage',()=>({deleteStoredRender:vi.fn(),isObjectStoragePath:(value:string|null)=>Boolean(value?.startsWith('s3://')),uploadRender:vi.fn()}));
import {query} from '../../server/db';
import {RenderJobQueue} from '../../server/services/renderJobQueue';

it('collector physically removes the expired owned QA artifact and clears its pointer',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'ayahx-a2b-gc-unit-')),file=join(directory,'owned-test.mp4');
  await writeFile(file,Buffer.from('owned unit fixture only'));
  vi.mocked(query).mockImplementation(async(sql:string)=>{
    if(sql.includes('SELECT id FROM render_jobs'))return[] as never;
    if(sql.includes('SELECT id, output_path FROM render_jobs')){
      expect(sql).toContain('expires_at < NOW()');
      return[{id:'owned-local-qa',output_path:file}] as never;
    }
    return{affectedRows:1} as never;
  });
  try{
    await(Object.create(RenderJobQueue.prototype) as RenderJobQueue).cleanupExpiredRenders();
    await expect(stat(file)).rejects.toMatchObject({code:'ENOENT'});
    expect(vi.mocked(query).mock.calls).toContainEqual([expect.stringContaining('UPDATE render_jobs SET output_path = NULL'),['owned-local-qa']]);
  }finally{
    // Directory belongs only to this test; no recursive deletion or path discovery.
    await rmdir(directory);
    vi.resetAllMocks();
  }
});
