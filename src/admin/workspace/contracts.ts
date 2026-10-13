import type { ListeningSample, ProviderDigest, ReviewItem } from '../../../shared/admin/batch5';
import type { CatalogProvider } from '../pages/catalog/catalogTypes';

export interface RoadmapStage { id: string; title_ar: string; title_en: string; status: string; summary_ar: string; blockers_ar: string[]; evidence: string[] }
export interface ProjectStatus { roadmap: { stages: RoadmapStage[]; visitor_state: unknown; owner_actions: unknown; public_flow_v2_ready: false }; guide_markdown: string }
export interface ProviderLicense extends CatalogProvider { digest: ProviderDigest; review_id: string | null }
export interface ReviewListMeta { total: number; page: number; limit: number; counts?: Array<{ type: string; status: string; count: number }> }
export interface LabelItem { id: string; display_label_ar: string | null; display_label_en?: string | null; generated_label_ar?: string; reciter_name_ar?: string; review_id: string | null }
export interface LicensedRecording { id: string; slug: string; reciter_name_ar: string; display_label_ar: string | null; channel_title: string | null; rights_status: string; total_chapters: number; verified_chapters: number; uploaded_chapters: number; pending_chapters: number; state: string }
export interface StoredAudio { id: string; surah: number; upload_status: string; size_bytes?: number; sha256?: string; rejection_reason?: string | null; verification_evidence?: unknown; created_at?: string }
export interface LicensedDetail { recitation: Record<string, unknown>; youtube: Array<{ id: string; surah: number; video_id: string; channel_title: string; rights_status: string; rights_evidence_url: string | null; rights_evidence_note: string | null; iframe_url: string | null }>; uploads: StoredAudio[]; rights_review_id: string | null; rights_approved: boolean; chapters: Array<{ surah: number; name_ar: string; availability_state: string; audio_status: string }> }
export interface StorageTask { id: string; status: string; progress: number | null; result: unknown; error_code: string | null }
export interface WizardOptions { providers: Array<{ id: string; code: string; name: string; host_allowlist: string[] }>; riwayat: Array<{ code: string; name_ar: string; name_en: string }>; imported_qud: Array<{ id: string; slug: string; display_label_ar: string; qud_version: string }> }
export interface WizardInput { intent_id: string; reciter: { id?: string; name_ar: string; name_en: string; country?: string; photo_url?: string }; recitation: { slug: string; riwayah_code: string; style: string; recording_year?: number; display_label_ar: string; display_label_en?: string }; source: { kind: 'url_pattern' | 'licensed_file' | 'youtube' | 'qud'; provider_id: string; url_pattern?: string; youtube_url?: string; qud_slug?: string } }
export interface WizardValidation { valid: boolean; checks: Array<{ surah: number; url: string; status: string; http_status: number | null; checked_at: string }>; timing: 'pending' | 'linked_imported_qud'; reason?: string; timing_reference?: unknown }
export interface WizardCreated { id: string; reciter_id: string; status: 'draft'; is_public: false; timing: string; review_ids: string[]; replay: boolean }
export interface RenderRecording { id: string; reciter_id: string; reciter_name_ar: string; display_label_ar: string; slug: string; provider: string }
export interface RenderChoices { recitations: RenderRecording[]; max_duration_ms: number; concurrency: number }
export interface RenderChapter { surah: number; name_ar: string; ayah_count: number; available_runs: Array<[number, number]>; availability_state: string }
export interface RenderJob { id: string; status: string; progress?: number; stage?: string | null; error?: string | null; error_code?: string | null; artifact?: { playPath: string; captionsPath?: string; captionsUnavailableReason?: string } | null; quality_summary?: { duration_ms: number; audio_sync: unknown; highlight: unknown; audio_bytes_fetched: number } | null; expires_at?: string | null }
export interface ListeningQueueItem { item: ReviewItem; samples: ListeningSample[] }

export interface RenderRecentJob { id: string; status: string; progress: number | null; stage: string | null; error_code: string | null; recitation_id: string; created_at: string; completed_at: string | null; expires_at: string | null; display_label_ar: string | null; reciter_name_ar: string | null; artifact_available: boolean }
