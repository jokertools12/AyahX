import {createHash} from 'node:crypto';
import {createLinkCheckpoint,type CatalogLinkCheckpoint,type CatalogLinkTarget} from './catalogLinkChecker';
const hash=(target:CatalogLinkTarget)=>createHash('sha256').update(JSON.stringify({...target,allowedHosts:[...target.allowedHosts].sort()})).digest('hex');
/** Explicit host-only rebinding. Original file remains immutable and no network runs here. */
export function migrateApprovedHostCheckpoint(before:CatalogLinkTarget[],after:CatalogLinkTarget[],old:CatalogLinkCheckpoint,approval:{evidenceSha256:string;approvedHosts:string[]}):CatalogLinkCheckpoint{
  createLinkCheckpoint(before,old);
  if(!/^[a-f0-9]{64}$/u.test(approval.evidenceSha256)||before.length!==after.length)throw new Error('HOST_MIGRATION_APPROVAL_INVALID');
  const checkpoint=createLinkCheckpoint(after),oldMap=new Map(before.map(r=>[r.key,r]));
  for(const next of after){const previous=oldMap.get(next.key);if(!previous)throw new Error('HOST_MIGRATION_TARGET_CHANGED');
    const {allowedHosts:oldHosts,...oldFields}=previous,{allowedHosts:newHosts,...newFields}=next;
    if(JSON.stringify(oldFields)!==JSON.stringify(newFields)||oldHosts.some(h=>!newHosts.includes(h))||newHosts.some(h=>!oldHosts.includes(h)&&!approval.approvedHosts.includes(h)))throw new Error('HOST_MIGRATION_NOT_APPROVED_WIDENING');
    const result=old.results[next.key];if(result)checkpoint.results[next.key]={...structuredClone(result),inputSha256:hash(next)};
  }
  checkpoint.conflicts=structuredClone(old.conflicts??[]);checkpoint.stoppedHistory=structuredClone(old.stoppedHistory??[]);
  return createLinkCheckpoint(after,checkpoint);
}
