CREATE TABLE `source_resolution_requests` (
  `server_request_id` VARCHAR(200) NOT NULL,
  `actor_reference` VARCHAR(200) NOT NULL,
  `ownership_reference` VARCHAR(200) NOT NULL,
  `purpose` ENUM('review','final_export') NOT NULL,
  `required_timing` ENUM('ayah','word','letter') NOT NULL,
  `lock_hash` CHAR(64) NOT NULL,
  `policy_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `policy_revision` VARCHAR(200) NOT NULL,
  `policy_json` JSON NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`server_request_id`),
  CONSTRAINT `chk_source_requests_lock_hash` CHECK (`lock_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_source_requests_policy_hash` CHECK (`policy_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_source_requests_payload_hash` CHECK (`payload_hash` REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `source_resolution_attempts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `server_request_id` VARCHAR(200) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `lock_hash` CHAR(64) NOT NULL,
  `policy_hash` CHAR(64) NOT NULL,
  `policy_revision` VARCHAR(200) NOT NULL,
  `ordinal` INT NOT NULL,
  `source_id` VARCHAR(200) NOT NULL,
  `source_revision` VARCHAR(200) NOT NULL,
  `phase` ENUM('started','terminal') NOT NULL,
  `started_at_epoch_ms` BIGINT UNSIGNED NOT NULL,
  `ended_at_epoch_ms` BIGINT UNSIGNED NULL,
  `duration_ms` BIGINT UNSIGNED NULL,
  `status` ENUM('selected','review_required','failed','rejected','skipped') NULL,
  `failure_class` VARCHAR(64) NULL,
  `reason_code` VARCHAR(64) NULL,
  `selected_marker` TINYINT GENERATED ALWAYS AS (IF(`phase` = 'terminal' AND `status` = 'selected', 1, NULL)) STORED,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_source_attempt_request` FOREIGN KEY (`server_request_id`) REFERENCES `source_resolution_requests` (`server_request_id`),
  CONSTRAINT `chk_source_attempt_payload_hash` CHECK (`payload_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_source_attempt_lock_hash` CHECK (`lock_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_source_attempt_policy_hash` CHECK (`policy_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_source_attempt_ordinal` CHECK (`ordinal` >= 0),
  CONSTRAINT `chk_source_attempt_duration` CHECK (`duration_ms` IS NULL OR `duration_ms` >= 0),
  CONSTRAINT `chk_source_attempt_phase_fields` CHECK ((`phase` = 'started' AND `ended_at_epoch_ms` IS NULL AND `duration_ms` IS NULL AND `status` IS NULL AND `failure_class` IS NULL AND `reason_code` IS NULL) OR (`phase` = 'terminal' AND `ended_at_epoch_ms` IS NOT NULL AND `duration_ms` IS NOT NULL AND `status` IS NOT NULL AND ((`status` IN ('selected','review_required') AND `failure_class` IS NULL AND `reason_code` IN ('candidate_validated','provisional_review')) OR (`status` IN ('failed','rejected','skipped') AND `failure_class` IS NOT NULL AND `reason_code` = `failure_class`)))),
  UNIQUE KEY `uq_source_attempt_request_ordinal_phase` (`server_request_id`,`ordinal`,`phase`),
  UNIQUE KEY `uq_source_attempt_request_selected` (`server_request_id`,`selected_marker`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TRIGGER `source_resolution_requests_no_update` BEFORE UPDATE ON `source_resolution_requests` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'source_resolution_requests are immutable';

CREATE TRIGGER `source_resolution_requests_no_delete` BEFORE DELETE ON `source_resolution_requests` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'source_resolution_requests are immutable';

CREATE TRIGGER `source_resolution_attempts_no_update` BEFORE UPDATE ON `source_resolution_attempts` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'source_resolution_attempts are immutable';

CREATE TRIGGER `source_resolution_attempts_no_delete` BEFORE DELETE ON `source_resolution_attempts` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'source_resolution_attempts are immutable';
