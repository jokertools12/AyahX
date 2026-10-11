import { describe,it,expect } from 'vitest';
import { isPubliclyVisible,parseRuns } from '../../server/services/catalogContracts';
import { requireCatalogPermission,canonicalAuditJson } from '../../server/services/catalogAudit';
describe('D4 public/human gates',()=>{
  it('all status, voice, license, flag and administrator-toggle combinations',()=>{
    let checked=0;
    for(const status of ['draft','imported','needs_review','published','hidden','deprecated'])
      for(const voice of ['unverified','auto_verified','confirmed','mismatch',null])for(const license of ['unreviewed','permitted','restricted',null])
        for(const policy of ['allow_auto_verified','require_confirmed'] as const) for(const flag of [true,false])for(const visible of [true,false,1,0,null]){
          expect(isPubliclyVisible({status,voice_identity_status:voice,license_status:license,is_public:visible},flag,policy)).toBe(status==='published'&&(voice==='confirmed'||(policy==='allow_auto_verified'&&voice==='auto_verified'))&&license==='permitted'&&flag&&(visible===true||visible===1));checked++;
        }
    expect(checked).toBe(2400);
  });
  it('permissions are explicit and system actors cannot make human approvals',()=>{
    const human={id:'reviewer',kind:'human' as const,permissions:new Set(['recitations.voice.review'])};
    expect(()=>requireCatalogPermission(human,'recitations.voice.review',true)).not.toThrow();
    expect(()=>requireCatalogPermission({...human,kind:'system'},'recitations.voice.review',true)).toThrow('CATALOG_PERMISSION_DENIED');
    expect(()=>requireCatalogPermission(human,'recitations.move')).toThrow('CATALOG_PERMISSION_DENIED');
    expect(()=>requireCatalogPermission({...human,id:''},'recitations.voice.review')).toThrow('CATALOG_PERMISSION_DENIED');
  });
  it('rejects malformed ranges instead of producing approximate or empty ranges',()=>{
    expect(parseRuns('[[1,3],[7,7]]')).toEqual([[1,3],[7,7]]);
    for(const value of [null,{},[[0,2]],[[4,2]],[[1.2,2]],[[1,2,3]]])expect(()=>parseRuns(value)).toThrow('AVAILABILITY_DATA_INVALID');
  });
  it('audit hashing survives MySQL JSON object key reordering',()=>{
    expect(canonicalAuditJson({z:{b:2,a:1},a:[3,1]})).toBe(canonicalAuditJson({a:[3,1],z:{a:1,b:2}}));
    expect(()=>canonicalAuditJson({bad:undefined})).toThrow('AUDIT_VALUE_NOT_SERIALIZABLE');
  });
});
