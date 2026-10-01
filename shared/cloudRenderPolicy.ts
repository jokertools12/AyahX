import { getPlanEntitlements, type SubscriptionPlan } from './planEntitlements';

export const CLOUD_ENGINES = ['ffmpeg_ass', 'skia_canvas', 'browser_cloud'] as const;
export type CloudEngine = (typeof CLOUD_ENGINES)[number];
export interface CloudRenderPolicy {
  enabledEngines: CloudEngine[];
  defaultEngine: CloudEngine | null;
  maxBacklog: number;
}

export function validateCloudRenderLimits(plan: SubscriptionPlan, manifest: {
  audio?: { durationSeconds?: number };
  audioEffects?: { speedAdjust?: number };
  outputDimensions?: { width?: number; height?: number };
  fps?: number;
}): string[] {
  const limits = getPlanEntitlements(plan);
  const violations: string[] = [];
  const duration = Number(manifest.audio?.durationSeconds);
  const speed = Number(manifest.audioEffects?.speedAdjust ?? 1);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(speed) || speed <= 0
      || Math.max(duration, duration / speed) > limits.cloudMaxDurationSeconds) {
    violations.push(`الحد الأقصى لمدة الفيديو السحابي ${limits.cloudMaxDurationSeconds / 60} دقائق. اختر مقطعًا أقصر.`);
  }
  const width = Number(manifest.outputDimensions?.width);
  const height = Number(manifest.outputDimensions?.height);
  const shortSide = plan === 'free' ? 720 : 1080;
  const longSide = plan === 'free' ? 1280 : 1920;
  if (!Number.isFinite(width) || !Number.isFinite(height)
      || Math.min(width, height) > shortSide || Math.max(width, height) > longSide) {
    violations.push(`الإنتاج السحابي يدعم حتى ${shortSide}p في باقتك.`);
  }
  if (!Number.isFinite(manifest.fps ?? 30) || Number(manifest.fps ?? 30) > 30) {
    violations.push('الإنتاج السحابي يدعم حتى 30 إطارًا في الثانية.');
  }
  return violations;
}
