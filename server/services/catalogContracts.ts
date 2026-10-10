import type { AyahRun } from './recitationAvailability';
export type CatalogRow = Record<string, unknown>;
export interface CatalogTx {
  read(sql: string, params?: unknown[]): Promise<CatalogRow[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}
export interface CatalogDatabase extends CatalogTx {
  transaction<T>(work: (tx: CatalogTx) => Promise<T>): Promise<T>;
}
export type AvailabilityMode = 'complete_only' | 'ayah_ranges';
export type VoiceGatePolicy = 'allow_auto_verified' | 'require_confirmed';
export interface CatalogSettings { enabled: boolean; availabilityMode: AvailabilityMode; voiceGatePolicy?: VoiceGatePolicy; storageAdapter?: 'url_reference'|'r2' }
export interface PublicRecitation {
  status: string; is_public: boolean | number | null; voice_identity_status: string | null; license_status: string | null;
}
/** Sole visibility rule. A technical publication never grants human approval. */
export function isPubliclyVisible(recitation: PublicRecitation, enabled: boolean, policy: VoiceGatePolicy = 'allow_auto_verified'): boolean {
  return enabled && recitation.status === 'published' && (recitation.is_public === true || recitation.is_public === 1) &&
    (recitation.voice_identity_status === 'confirmed' || (policy === 'allow_auto_verified' && recitation.voice_identity_status === 'auto_verified')) && recitation.license_status === 'permitted';
}
/** SQL prefilter for the same policy; direct record access always applies isPubliclyVisible. */
export function publicCatalogSql(policy: VoiceGatePolicy = 'allow_auto_verified'): string {
  const voice = policy === 'allow_auto_verified' ? "r.voice_identity_status IN ('auto_verified','confirmed')" : "r.voice_identity_status='confirmed'";
  return `r.status='published' AND r.is_public=1 AND ${voice} AND p.license_status='permitted'`;
}
export class CatalogError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly details: CatalogRow = {}) {
    super(code); this.name = 'CatalogError';
  }
}
export interface AudioPlanInput { recitationId: string; surah: number; from: number; to: number; padMs?: number }
export interface CatalogAudioPlan {
  recitationId: string; mode: 'surah_slice'; coordinate: 'source_ms';
  parts: Array<{url:string;sliceFromMs:number;sliceToMs:number}>;
  provider: string; license: string | null; attribution: string | null;
  fallbackUsed: boolean; fallbackReason?: string; alternateSourceId?: string;
}
export interface CatalogAudioResolver { resolveAudioPlan(input: AudioPlanInput): Promise<CatalogAudioPlan> }
export const parseRuns = (value: unknown): AyahRun[] => {
  const raw: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(raw) || raw.some(r=>!Array.isArray(r)||r.length!==2||!Number.isSafeInteger(r[0])||!Number.isSafeInteger(r[1])||r[0]<1||r[1]<r[0])) throw new CatalogError('AVAILABILITY_DATA_INVALID',503);
  return raw as AyahRun[];
};
