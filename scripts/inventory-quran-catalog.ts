import { writeFile } from 'node:fs/promises';
import { captureInventory, ENVIRONMENTS } from './lib/railwayQuranOps';

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const target = option('--target');
if (target !== 'production' && target !== 'staging') throw new Error('EXPLICIT_TARGET_REQUIRED');
const inventory = await captureInventory(ENVIRONMENTS[target]);
if (inventory.tables.some(({ name }) => ['reciters', 'audio_providers', 'recitations', 'recitation_chapters'].includes(name))) throw new Error('D2_TABLE_COLLISION_STOP');
await writeFile(option('--out') || `docs/data/d2-railway-${target}-inventory.json`, JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ target, mysql: inventory.mysql_version, tables: inventory.tables.length, critical: inventory.critical_counts, d1: inventory.d1_counts, checksum: inventory.canonical_checksum, collisions: [] }));
