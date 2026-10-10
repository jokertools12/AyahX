/** Read-only physical storage proof; never reads database/key file contents. */
import { writeFileSync } from 'node:fs';
import { ENVIRONMENTS, ssh } from './lib/railwayQuranOps';

if (!process.argv.includes('--production-read-only')) throw new Error('EXPLICIT_READ_ONLY_SCOPE_REQUIRED');
const index = process.argv.indexOf('--out');
if (index < 0 || !process.argv[index + 1]) throw new Error('OUT_REQUIRED');
const output = await ssh(ENVIRONMENTS.production, `set -e
df -B1 --output=size,used,avail /var/lib/mysql | tail -n 1 | awk '{printf "{\\"kind\\":\\"df\\",\\"total_bytes\\":%s,\\"used_bytes\\":%s,\\"available_bytes\\":%s}\\n",$1,$2,$3}'
for item in railway '#innodb_redo' undo_001 undo_002; do
  du -B1 -s "/var/lib/mysql/$item" | awk -v name="$item" '{printf "{\\"kind\\":\\"allocated\\",\\"name\\":\\"%s\\",\\"bytes\\":%s}\\n",name,$1}'
done
for item in ayah_timings import_jobs ayah_timing_history; do
  stat -c '%s %b' "/var/lib/mysql/railway/$item.ibd" | awk -v name="$item" '{printf "{\\"kind\\":\\"table_file\\",\\"name\\":\\"%s\\",\\"logical_bytes\\":%s,\\"allocated_bytes\\":%.0f}\\n",name,$1,$2*512}'
done`);
const measurements = output.trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
if (measurements.length !== 8 || measurements[0].kind !== 'df') throw new Error('CAPACITY_PROOF_INCOMPLETE');
const report = { checked_at: new Date().toISOString(), read_only: true, measurements };
writeFileSync(process.argv[index + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
