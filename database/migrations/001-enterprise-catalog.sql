-- Task 1.1: inactive additive foundation. No seeds or runtime activation.
CREATE TABLE quran_data_sources (
  id VARCHAR(200) NOT NULL,
  revision VARCHAR(200) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  review_json JSON NOT NULL,
  PRIMARY KEY (id, revision),
  CONSTRAINT chk_catalog_source_disabled CHECK (enabled = FALSE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE mushaf_profiles (
  id VARCHAR(200) NOT NULL,
  revision VARCHAR(200) NOT NULL,
  riwayah_code VARCHAR(200) NOT NULL,
  numbering_system VARCHAR(200) NOT NULL,
  source_id VARCHAR(200) NOT NULL,
  source_revision VARCHAR(200) NOT NULL,
  text_revision VARCHAR(200) NOT NULL,
  text_sha256 CHAR(64) NOT NULL,
  surah_ayah_counts JSON NOT NULL,
  font_binding_json JSON NOT NULL,
  approval_json JSON DEFAULT NULL,
  PRIMARY KEY (id, revision),
  CONSTRAINT fk_catalog_profile_source FOREIGN KEY (source_id, source_revision) REFERENCES quran_data_sources (id, revision),
  CONSTRAINT chk_catalog_text_sha CHECK (text_sha256 REGEXP '^[a-f0-9]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE reciter_catalog (
  id VARCHAR(200) NOT NULL,
  display_name VARCHAR(500) NOT NULL,
  identity_json JSON NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE reciter_recordings (
  id VARCHAR(200) NOT NULL,
  reciter_id VARCHAR(200) NOT NULL,
  mushaf_profile_id VARCHAR(200) NOT NULL,
  mushaf_profile_revision VARCHAR(200) NOT NULL,
  source_id VARCHAR(200) NOT NULL,
  source_revision VARCHAR(200) NOT NULL,
  variant VARCHAR(200) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  current_availability_revision VARCHAR(200) DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_catalog_current_coverage (id, current_availability_revision),
  CONSTRAINT fk_catalog_recording_reciter FOREIGN KEY (reciter_id) REFERENCES reciter_catalog (id),
  CONSTRAINT fk_catalog_recording_profile FOREIGN KEY (mushaf_profile_id, mushaf_profile_revision) REFERENCES mushaf_profiles (id, revision),
  CONSTRAINT fk_catalog_recording_source FOREIGN KEY (source_id, source_revision) REFERENCES quran_data_sources (id, revision),
  CONSTRAINT chk_catalog_recording_inactive CHECK (active = FALSE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Snapshot body/checksum and original approval are append-only by repository contract.
-- No approval, publication, revocation or snapshot writer is exposed by this slice.
CREATE TABLE recitation_coverage (
  recording_id VARCHAR(200) NOT NULL,
  revision VARCHAR(200) NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_sha256 CHAR(64) NOT NULL,
  approval_actor_id VARCHAR(200) DEFAULT NULL,
  approved_at DATETIME(3) DEFAULT NULL,
  approval_evidence_id VARCHAR(200) DEFAULT NULL,
  approval_checksum CHAR(64) DEFAULT NULL,
  revoked_by VARCHAR(200) DEFAULT NULL,
  revoked_at DATETIME(3) DEFAULT NULL,
  revocation_evidence_id VARCHAR(200) DEFAULT NULL,
  PRIMARY KEY (recording_id, revision),
  CONSTRAINT fk_catalog_coverage_recording FOREIGN KEY (recording_id) REFERENCES reciter_recordings (id),
  CONSTRAINT chk_catalog_snapshot_sha CHECK (snapshot_sha256 REGEXP '^[a-f0-9]{64}$'),
  CONSTRAINT chk_catalog_approval CHECK ((approval_actor_id IS NULL AND approved_at IS NULL AND approval_evidence_id IS NULL AND approval_checksum IS NULL) OR (approval_actor_id IS NOT NULL AND approved_at IS NOT NULL AND approval_evidence_id IS NOT NULL AND approval_checksum IS NOT NULL AND approval_checksum REGEXP '^[a-f0-9]{64}$')),
  CONSTRAINT chk_catalog_revocation CHECK ((revoked_by IS NULL AND revoked_at IS NULL AND revocation_evidence_id IS NULL) OR (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revocation_evidence_id IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

ALTER TABLE reciter_recordings ADD CONSTRAINT fk_catalog_current_coverage FOREIGN KEY (id, current_availability_revision) REFERENCES recitation_coverage (recording_id, revision);
