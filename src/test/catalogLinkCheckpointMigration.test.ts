import {describe,it,expect} from 'vitest';
import {createLinkCheckpoint,runCatalogLinkChecks,type CatalogLinkTarget} from '../../server/services/catalogLinkChecker';
import {migrateApprovedHostCheckpoint} from '../../server/services/catalogLinkCheckpointMigration';
const target:CatalogLinkTarget={key:'chapter:1',kind:'chapter',id:'1',recitationId:'r',reciterId:'reader',recitationSlug:'slug',surah:1,url:'https://archive.org/download/example/001.mp3',allowedHosts:['archive.org']};
describe('explicit checkpoint host widening',()=>{
  it('preserves original checks and permits only the bound host widening',async()=>{
    const old=await runCatalogLinkChecks([target],{checkpoint:createLinkCheckpoint([target]),checkLink:async()=>({status:'available',httpStatus:200,checkedAt:new Date().toISOString(),finalUrl:target.url}),persist:()=>{}});
    const original=JSON.stringify(old),next={...target,allowedHosts:['archive.org','*.us.archive.org']};
    const migrated=migrateApprovedHostCheckpoint([target],[next],old,{evidenceSha256:'a'.repeat(64),approvedHosts:['*.us.archive.org']});
    expect(migrated.results[target.key].check).toEqual(old.results[target.key].check);expect(JSON.stringify(old)).toBe(original);expect(migrated.inputSha256).not.toBe(old.inputSha256);
    for(const candidate of [{...next,url:'https://archive.org/other.mp3'},{...next,reciterId:'other'},{...next,allowedHosts:['*.us.archive.org']},{...next,allowedHosts:['archive.org','evil.example']}])expect(()=>migrateApprovedHostCheckpoint([target],[candidate],old,{evidenceSha256:'a'.repeat(64),approvedHosts:['*.us.archive.org']})).toThrow();
    expect(()=>migrateApprovedHostCheckpoint([target],[next],old,{evidenceSha256:'bad',approvedHosts:['*.us.archive.org']})).toThrow();
  });
});
