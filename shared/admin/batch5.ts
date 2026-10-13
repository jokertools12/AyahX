/** Browser-safe contracts. No credentials, signed media capabilities or server imports. */
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'deferred';
export type ReviewType = 'voice_confirmation' | 'provider_license' | 'label_review' | 'offset_exception' | 'basmala_audio' | 'youtube_rights' | 'youtube_audio_missing' | 'near_complete_chapters' | 'data_conflict' | 'same_audio_conflict' | 'storage_activation' | 'storage_credentials' | 'storage_rights';
export interface ReviewCount { type: ReviewType; status: ReviewStatus; count: number; eligible_count: number }
export interface ReviewItem { id: string; type: ReviewType; subject_type: string; subject_id: string; status: ReviewStatus; priority: number; recitation_id: string | null; reciter_name_ar: string | null; display_label_ar: string | null; provider_name: string | null; eligible: boolean; evidence: unknown; notes: string | null; decision: unknown; decided_at: string | null; supersedes_id: string | null; created_at: string }
export interface ReviewDecisionInput { status: Exclude<ReviewStatus, 'pending'>; notes: string; decision?: Record<string, unknown>; confirmation?: string }
export interface ListeningSample { sample_key: string; surah: number; status: string; preview_url?: string; url?: string; embed_url?: string; iframe_url?: string; start_ms?: number; duration_ms?: number | null; reason?: string }
export interface LaunchCheck { code: string; title: string; complete: boolean; count: number; owner: string }
export interface LaunchSummary { completed: number; total: number; percent: number; checks: LaunchCheck[] }
export interface LaunchPreview { id: string; slug: string; reciter_name_ar: string; display_label_ar: string | null; is_visible: boolean; reasons: string[] }
export interface LaunchReadiness extends LaunchSummary { catalog_enabled: boolean; public_flow_v2_ready: false; can_open: false; blocked_reason: string; preview: LaunchPreview[] }
export interface WorkspaceSummary { review_counts: ReviewCount[]; launch: LaunchSummary; alerts: Array<{ code: string; message: string; count?: number; expires_at?: string }>; public_state: { catalog_enabled: boolean; public_flow_v2_ready: false; message: string } }
export interface AdminPreferences { density: 'comfortable' | 'compact'; font_scale: 1 | 1.1 | 1.2 }
export interface ListeningRoom { recitation: Record<string, unknown>; samples: ListeningSample[]; same_reciter: Array<{ id: string; display_label_ar: string | null; voice_identity_status: string }>; evidence: unknown; history: Array<Record<string, unknown>>; review_id: string | null; next_id: string | null }
export interface ProviderDigest { programmatic: string; commercial: string; attribution: string; terms_url: string | null }
export interface StorageSummary { adapter: string; configured: boolean; bucket: string | null; usage: { bytes: number; gb: number; object_count: number; measured_at: string;source:'r2_list'|'database_manifest' }; token_expires_at: string | null; token_days_remaining: number | null; renewal_steps: string[]; uploads: Array<Record<string, unknown>>; alerts: Array<{ code: string; message: string }> }
