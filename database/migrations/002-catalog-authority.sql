-- Task 1.2 additive, inactive authority persistence. No grants or bootstrap seeds.
-- IDs remain pseudonymous history references after account deletion; there is no
-- FK/cascade to users. Writers must lock and verify a live user before granting.
CREATE TABLE catalog_role_grants (
  id VARCHAR(200) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('read_only', 'editor', 'approver', 'owner') NOT NULL,
  granting_audit_event_id VARCHAR(200) NOT NULL,
  granted_at_epoch_ms BIGINT UNSIGNED NOT NULL,
  revoked_at_epoch_ms BIGINT UNSIGNED DEFAULT NULL,
  revocation_audit_event_id VARCHAR(200) DEFAULT NULL,
  active_marker TINYINT GENERATED ALWAYS AS (IF(revoked_at_epoch_ms IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_active_role (user_id, role, active_marker),
  KEY idx_catalog_grant_created_event (granting_audit_event_id),
  KEY idx_catalog_grant_revoked_event (revocation_audit_event_id),
  CONSTRAINT chk_catalog_grant_time CHECK (granted_at_epoch_ms <= 9007199254740991),
  CONSTRAINT chk_catalog_grant_revocation CHECK (
    (revoked_at_epoch_ms IS NULL AND revocation_audit_event_id IS NULL) OR
    (revoked_at_epoch_ms IS NOT NULL AND revocation_audit_event_id IS NOT NULL
      AND revoked_at_epoch_ms >= granted_at_epoch_ms AND revoked_at_epoch_ms <= 9007199254740991)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE catalog_audit_events (
  id VARCHAR(200) NOT NULL,
  action ENUM('owner_bootstrap', 'grant_create', 'grant_revoke', 'draft_write',
    'content_approve', 'content_reject', 'content_revoke', 'source_activate', 'retention_manage') NOT NULL,
  actor_user_id VARCHAR(36) NOT NULL,
  authorizing_grant_id VARCHAR(200) DEFAULT NULL,
  required_capability ENUM('draft_write', 'content_approve', 'content_reject', 'content_revoke',
    'grant_manage', 'source_activate', 'retention_manage') NOT NULL,
  created_at_epoch_ms BIGINT UNSIGNED NOT NULL,
  request_id VARCHAR(200) NOT NULL,
  request_payload_sha256 CHAR(64) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  subject_kind ENUM('grant', 'source', 'profile', 'coverage', 'timing', 'retention', 'draft') NOT NULL,
  subject_id VARCHAR(200) NOT NULL,
  subject_revision VARCHAR(200) NOT NULL,
  subject_sha256 CHAR(64) NOT NULL,
  context_json JSON NOT NULL,
  context_sha256 CHAR(64) NOT NULL,
  before_json JSON DEFAULT NULL,
  after_json JSON DEFAULT NULL,
  revokes_event_id VARCHAR(200) DEFAULT NULL,
  bootstrap_marker TINYINT GENERATED ALWAYS AS (IF(action = 'owner_bootstrap', 1, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_catalog_actor_request (actor_user_id, request_id),
  UNIQUE KEY uq_catalog_single_bootstrap (bootstrap_marker),
  UNIQUE KEY uq_catalog_single_revocation (revokes_event_id),
  KEY idx_catalog_audit_subject (subject_kind, subject_id, subject_revision, created_at_epoch_ms),
  CONSTRAINT fk_catalog_audit_grant FOREIGN KEY (authorizing_grant_id) REFERENCES catalog_role_grants (id),
  CONSTRAINT fk_catalog_audit_revokes FOREIGN KEY (revokes_event_id) REFERENCES catalog_audit_events (id),
  CONSTRAINT chk_catalog_audit_time CHECK (created_at_epoch_ms <= 9007199254740991),
  CONSTRAINT chk_catalog_audit_hashes CHECK (
    request_payload_sha256 REGEXP '^[a-f0-9]{64}$' AND subject_sha256 REGEXP '^[a-f0-9]{64}$'
    AND context_sha256 REGEXP '^[a-f0-9]{64}$'
  ),
  CONSTRAINT chk_catalog_audit_reason CHECK (CHAR_LENGTH(TRIM(reason)) > 0),
  CONSTRAINT chk_catalog_audit_bootstrap CHECK (
    (action = 'owner_bootstrap' AND authorizing_grant_id IS NULL AND required_capability = 'grant_manage'
      AND subject_kind = 'grant' AND revokes_event_id IS NULL) OR
    (action <> 'owner_bootstrap' AND authorizing_grant_id IS NOT NULL)
  ),
  CONSTRAINT chk_catalog_audit_revocation CHECK (
    (action IN ('grant_revoke', 'content_revoke') AND revokes_event_id IS NOT NULL) OR
    (action NOT IN ('grant_revoke', 'content_revoke') AND revokes_event_id IS NULL)
  ),
  CONSTRAINT chk_catalog_audit_capability CHECK (
    (action IN ('owner_bootstrap', 'grant_create', 'grant_revoke') AND required_capability = 'grant_manage') OR
    (action = 'draft_write' AND required_capability = 'draft_write') OR
    (action = 'content_approve' AND required_capability = 'content_approve') OR
    (action = 'content_reject' AND required_capability = 'content_reject') OR
    (action = 'content_revoke' AND required_capability = 'content_revoke') OR
    (action = 'source_activate' AND required_capability = 'source_activate') OR
    (action = 'retention_manage' AND required_capability = 'retention_manage')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

ALTER TABLE catalog_role_grants
  ADD CONSTRAINT fk_catalog_grant_created_event FOREIGN KEY (granting_audit_event_id) REFERENCES catalog_audit_events (id),
  ADD CONSTRAINT fk_catalog_grant_revoked_event FOREIGN KEY (revocation_audit_event_id) REFERENCES catalog_audit_events (id);

-- Single-statement triggers deliberately contain no BEGIN/DELIMITER block.
CREATE TRIGGER catalog_audit_no_update BEFORE UPDATE ON catalog_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CATALOG_AUDIT_APPEND_ONLY';
CREATE TRIGGER catalog_audit_no_delete BEFORE DELETE ON catalog_audit_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CATALOG_AUDIT_APPEND_ONLY';
