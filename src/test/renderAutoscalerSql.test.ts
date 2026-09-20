import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Render autoscaler SQL compatibility', () => {
  it('groups by the full engine expression for MySQL ONLY_FULL_GROUP_BY', () => {
    const autoscaler = fs.readFileSync(path.resolve(process.cwd(), 'server/services/renderAutoscaler.ts'), 'utf8');
    const observability = fs.readFileSync(path.resolve(process.cwd(), 'server/services/renderObservability.ts'), 'utf8');
    for (const source of [autoscaler, observability]) {
      expect(source).toContain(
        "GROUP BY COALESCE(engine, JSON_UNQUOTE(JSON_EXTRACT(manifest, '$.renderEngine')), 'ffmpeg_ass'), status",
      );
      expect(source).not.toContain('GROUP BY engine, status');
    }
  });
});
