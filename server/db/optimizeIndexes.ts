import { query } from '../db';

export interface IndexDefinition {
  table: string;
  name: string;
  columns: string;
}

export const PERFORMANCE_INDEXES: IndexDefinition[] = [
  { table: 'saved_videos', name: 'idx_saved_videos_public_created', columns: '(`is_public`, `created_at` DESC)' },
  { table: 'saved_videos', name: 'idx_saved_videos_user_created', columns: '(`user_id`, `created_at` DESC)' },
  { table: 'saved_videos', name: 'idx_saved_videos_surah', columns: '(`surah_number`)' },
  { table: 'saved_videos', name: 'idx_saved_videos_reciter', columns: '(`reciter_id`)' },
  { table: 'video_comments', name: 'idx_comments_video_created', columns: '(`video_id`, `created_at` ASC)' },
  { table: 'notifications', name: 'idx_notifications_user_created', columns: '(`user_id`, `created_at` DESC)' },
  { table: 'daily_video_usage', name: 'idx_daily_usage_date', columns: '(`date`)' },
  { table: 'subscriptions', name: 'idx_subscriptions_status_expires', columns: '(`status`, `expires_at`)' },
];

export async function applyPerformanceIndexes(): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const idx of PERFORMANCE_INDEXES) {
    try {
      const rows = await query<any[]>(
        `SHOW INDEX FROM \`${idx.table}\` WHERE Key_name = ?`,
        [idx.name]
      );
      if (rows.length === 0) {
        await query(`ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\` ${idx.columns}`);
        created.push(`${idx.table}.${idx.name}`);
      } else {
        existing.push(`${idx.table}.${idx.name}`);
      }
    } catch (err: any) {
      console.warn(`Could not verify or apply index ${idx.table}.${idx.name}:`, err.message);
    }
  }

  return { created, existing };
}

// Self-executing if invoked directly via CLI
if (process.argv[1]?.includes('optimizeIndexes')) {
  applyPerformanceIndexes()
    .then((res) => {
      console.log('Performance indexes report:');
      console.log(`- Created: ${res.created.length > 0 ? res.created.join(', ') : 'None (all present)'}`);
      console.log(`- Existing: ${res.existing.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error applying performance indexes:', err);
      process.exit(1);
    });
}
