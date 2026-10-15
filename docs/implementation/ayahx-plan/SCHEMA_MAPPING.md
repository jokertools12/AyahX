# Task 1.1 — schema mapping (source inventory)

This maps the package proposal to checkout source only; no live database was queried and no row counts are inferred. The package SQL is explicitly reference-only (`04_DATABASE/migration-001-admin-data-mesh.proposed.sql`).

## Current persistence and migration evidence

- `database/schema.sql:8-42` defines `users`, `profiles`, and `user_roles`; roles are an enum (`admin`, `moderator`, `user`). `saved_videos` and `render_jobs` are existing protected product tables (`:44-70`, `:269-306`); `system_settings` follows at `:308`.
- `server/db/setup.ts:24-35` performs ad-hoc additive column checks; `:45-78` runs the schema and indexes. This is not a versioned migration ledger or transactional migration framework.
- `server/index.ts:27-30,271` calls `ensureAlignmentTables()` at startup. `server/db/migrations/addAlignmentTables.ts:76-125` creates/extends alignment tables and retention fields.
- `alignment_documents` already has `id VARCHAR(191)`, `user_id`, `provider_id`, validation/review statuses, audio hash, surah/ayah bounds, `document_json`, expiry and timestamps. Repository reads/writes the JSON document and ownership/revision records (`server/services/alignmentRepository.ts:20-29,45-65,80-120`). It contains user-generated/provider alignment documents, not the proposal's normalized identity-bound certificate.
- `shared/recordingAvailability.ts:4-30,38-78` is authoritative for scope, fingerprints, timing evidence/review states, snapshot source/revision and one-hour expiry. A DB projection must preserve all these semantics; intervals are gap-aware and verified audio requires asset ID plus SHA-256.

## Proposal-to-checkout matrix

| Proposed table | Disposition | Evidence, incompatibility, and dependency/risk |
|---|---|---|
| `mushaf_profiles` | New | No equivalent canonical profile table found in `database/schema.sql`. Retain riwayah, numbering system, text source/revision and exact text fingerprint; `font_asset_id` must resolve to reviewed licensed asset metadata. Depends on source/font review. |
| `quran_data_sources` | New | No source registry table found. `base_url`, terms, CORS, storage and enablement need reviewed evidence; candidate registry is not authorization to enable a source. |
| `reciter_catalog` | New | `favorite_reciters`/`favorite_performers` (`schema.sql:232-252`) are user preference joins, not canonical reciter catalog. Keep source mapping separate and reviewed. Depends on mushaf/source identity decisions. |
| `reciter_recordings` | New | No recording identity table found. Must retain recording-specific scope and availability revision/expiry; do not infer coverage from reciter existence. Depends on reciter and mushaf rows. |
| `recitation_coverage` | New, revise contract | Natural match for snapshot intervals, but draft omits snapshot `revision`, text revision/fingerprint and explicit scope fields; timing review enum lacks `rejected`/`expired`, and timing document/revision/evidence/validated-levels are absent. Preserve verified/missing/unknown and prohibit timing for unverified audio. Depends on recordings and sources. |
| `alignment_documents` | Existing; do not CREATE/replace | Direct collision: proposal uses `id VARCHAR(36)`, `alignment_json`, identity FKs and required `mushaf_profile_id`; existing uses `VARCHAR(191)`, `document_json`, `user_id`, `provider_id`, validation status, audio hash and nullable expiry. `CREATE TABLE IF NOT EXISTS` would silently leave either schema incompatible. Keep existing owner data/revisions intact. |
| `ornamental_assets` | New | No equivalent found. Object key/hash/license metadata require storage and redistribution review before activation. |
| `studio_templates` | New | No equivalent found. `saved_videos` are user outputs, not versioned reviewed templates. Keep template review/premium policy distinct. |
| `admin_audit_events` | New | No equivalent found. Do not repurpose `notifications`; specify actor retention and audit immutability before write path. |
| `source_resolution_attempts` | New | No equivalent found. Resolve `request_id`/recording and retention/privacy policy first; proposal lacks FKs by design. Never log credentials or private media. |
| `render_attempts` | New | `render_jobs` (`schema.sql:269-306`) remains the job state/queue record. Attempts may be additive history; proposal's `render_job_id VARCHAR(120)` must match actual `render_jobs.id` before adding FK. Preserve current Skia/FFmpeg pipeline semantics. |

## Bounded first migration recommendation

First reviewable schema slice: at most five new tables—`quran_data_sources`, `mushaf_profiles`, `reciter_catalog`, `reciter_recordings`, and `recitation_coverage`—ordered by FK dependency. Before implementation, reconcile coverage fields against `AvailabilitySnapshot` and `TimingBinding`; keep all source/asset records disabled or review-pending by default. Defer all alignment alterations, audit/attempt tables, ornamental assets, templates, and runtime activation. No SQL is approved by this mapping.

Before any named-environment migration: verify protected-table policy and migration runner; capture and verify a backup; rehearse on a restored copy; run dry-run/schema-diff and targeted validation; use the owner-authorized execution workflow after review and gates. Acceptance evidence should show exact before/after schema for the five tables, no changes to `users`, `user_roles`, `render_jobs`, `saved_videos`, or existing alignment rows; FK/index/enum checks; snapshot expiry/gap/identity tests; and successful restore rehearsal. Source schema inspection cannot establish live deployment state or counts.
