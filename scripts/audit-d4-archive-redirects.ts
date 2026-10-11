/** Network-only provider audit. Never writes DB or persists audio. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {CatalogAudioSource,isPublicAudioAddress} from '../server/services/catalogAudioSource';
const option=(k:string)=>{const i=process.argv.indexOf(k);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
const initial=JSON.parse(readFileSync(option('--initial-report'),'utf8'));
const prior=JSON.parse(readFileSync(option('--prior-report'),'utf8'));
const rows=initial.failed_urls.filter((r:{status:string})=>r.status==='AUDIO_HOST_NOT_ALLOWED');
const source=new CatalogAudioSource(undefined,1000);
const report:{started_at:string;old_inventory_sha256:string;new_hosts:string[];checks:unknown[];passed?:boolean;finished_at?:string}={started_at:new Date().toISOString(),old_inventory_sha256:initial.input_sha256,new_hosts:[],checks:[]};
const candidates=new Set<string>(prior.checks.flatMap((c:{checked?:{redirects?:string[]}})=>c.checked?.redirects??[]).map((u:string)=>new URL(u).hostname).filter((h:string)=>/^[a-z0-9-]+\.ca\.archive\.org$/u.test(h)));
for(const row of rows){
  const originalHost=new URL(row.original_url).hostname;
  assert.ok(originalHost==='archive.org'||/^[a-z0-9-]+\.us\.archive\.org$/u.test(originalHost),'NON_ARCHIVE_PROVIDER_REQUIRES_SEPARATE_AUDIT');
  const previous=prior.checks.find((p:{target_key:string})=>p.target_key===row.target_key);
  let checked=previous?.approved_namespace?previous.checked:await source.checkLink(row.original_url,['archive.org','*.us.archive.org',...candidates]);
  const attempts=[];
  for(let attempt=1;checked.status==='AUDIO_HOST_NOT_ALLOWED'&&attempt<3;attempt++){
    const next=checked.redirects?.at(-1);const host=next?new URL(next).hostname:null;
    if(!host||!/^[a-z0-9-]+\.ca\.archive\.org$/u.test(host)||candidates.has(host))break;
    attempts.push(checked);candidates.add(host);
    checked=await source.checkLink(row.original_url,['archive.org','*.us.archive.org',...candidates]);
  }
  const proof=checked.transport_evidence??[];
  const tls=proof.length>0&&proof.every(p=>p.tls_authorized&&p.certificate_sha256&&p.dns_addresses.length&&p.dns_addresses.every(isPublicAudioAddress)&&p.connected_address&&isPublicAudioAddress(p.connected_address));
  const approved=tls&&proof.some(p=>p.host.endsWith('.archive.org'));
  if(approved)report.new_hosts=[...new Set([...report.new_hosts,...proof.filter(p=>p.host!=='archive.org').map(p=>p.host)])].sort();
  report.checks.push({target_key:row.target_key,recitation:row.recitation,surah:row.surah,original_url:row.original_url,prior_evidence:previous??null,additional_observations:attempts,namespace:'*.us.archive.org plus individually observed Canadian CDN hosts',approved_namespace:approved,checked});
  writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');
  if(report.checks.length%25===0)console.log(JSON.stringify({checked:report.checks.length,total:rows.length,hosts:report.new_hosts.length}));
}
report.passed=report.new_hosts.length>0;report.finished_at=new Date().toISOString();writeFileSync(option('--report'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checked:report.checks.length,hosts:report.new_hosts.length}));
