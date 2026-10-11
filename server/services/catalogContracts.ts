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
export interface CatalogSettings { enabled: boolean; availabilityMode: AvailabilityMode; voiceGatePolicy?: VoiceGatePolicy; storageAdapter?: 'url_reference'|'r2'; showTimingBadges?:boolean; defaultAttributionText?:string }
export interface PublicRecitation {
  status: string; is_public: boolean | number | null; voice_identity_status: string | null; license_status: string | null;
  reciter_is_visible?:boolean|number|null; riwayah_is_active?:boolean|number|null;
}
export function publicVisibilityCodes(r:PublicRecitation,enabled:boolean,policy:VoiceGatePolicy='allow_auto_verified'):string[]{
  const codes:string[]=[];
  if(!enabled)codes.push('CATALOG_DISABLED');if(r.status!=='published')codes.push('TECHNICAL_NOT_PUBLISHED');
  if(r.is_public!==true&&r.is_public!==1)codes.push('PUBLIC_SWITCH_OFF');
  if(r.voice_identity_status!=='confirmed'&&!(policy==='allow_auto_verified'&&r.voice_identity_status==='auto_verified'))codes.push('VOICE_GATE_INCOMPLETE');
  if(r.license_status!=='permitted')codes.push('PROVIDER_LICENSE_UNAPPROVED');
  if(r.reciter_is_visible!==undefined&&r.reciter_is_visible!==null&&r.reciter_is_visible!==true&&r.reciter_is_visible!==1)codes.push('RECITER_HIDDEN');
  if(r.riwayah_is_active!==undefined&&r.riwayah_is_active!==true&&r.riwayah_is_active!==1)codes.push('RIWAYAH_DISABLED');
  return codes;
}
/** Sole visibility rule. A technical publication never grants human approval. */
export function isPubliclyVisible(recitation: PublicRecitation, enabled: boolean, policy: VoiceGatePolicy = 'allow_auto_verified'): boolean {
  return publicVisibilityCodes(recitation,enabled,policy).length===0;
}
/** SQL prefilter for the same policy; direct record access always applies isPubliclyVisible. */
export function publicCatalogSql(policy: VoiceGatePolicy = 'allow_auto_verified'): string {
  const voice = policy === 'allow_auto_verified' ? "r.voice_identity_status IN ('auto_verified','confirmed')" : "r.voice_identity_status='confirmed'";
  return `r.status='published' AND r.is_public=1 AND ${voice} AND p.license_status='permitted' AND EXISTS(SELECT 1 FROM reciters pv WHERE pv.id=r.reciter_id AND COALESCE(pv.is_visible,1)=1) AND EXISTS(SELECT 1 FROM riwayat pr WHERE pr.id=r.riwayah_id AND pr.is_active=1)`;
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
