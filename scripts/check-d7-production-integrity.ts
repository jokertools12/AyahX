/** Root read-only diagnostic. Never emits user identities or stored credentials. */
import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readSql,ENVIRONMENTS,identifier } from './lib/railwayQuranOps';
const baseline=JSON.parse(await readFile(process.env.LOCALAPPDATA+'/AyahX/private-backups/d7-production-before.json','utf8'));
const tables=['users','profiles','subscriptions','payment_requests','saved_videos','render_jobs','system_settings','user_roles','notifications','quran_surahs','quran_ayahs','quran_words','ayah_timings'];
const raw=await readSql(ENVIRONMENTS.production,tables.map(name=>`SELECT '${name}',COUNT(*) FROM ${identifier(name)}`).join(' UNION ALL ')+';');
const counts=Object.fromEntries(raw.trim().split(/\r?\n/u).map(line=>{const [name,count]=line.split('\t');return[name,Number(count)];}));
const sumsRaw=await readSql(ENVIRONMENTS.production,'CHECKSUM TABLE '+tables.map(identifier).join(',')+';');
const sums=Object.fromEntries(sumsRaw.trim().split(/\r?\n/u).map(line=>{const [name,sum]=line.split('\t');return[name.split('.').pop(),sum];}));
const result={checked_at:new Date().toISOString(),production_writes:0,tables:tables.map(name=>({table:name,before:baseline.row_counts[name],after:counts[name],checksum_before:baseline.checksums[name],checksum_after:sums[name]}))};
await writeFile('docs/data/d7-integrity-read.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,evidence_sha256:createHash('sha256').update(JSON.stringify(result)).digest('hex')}));
