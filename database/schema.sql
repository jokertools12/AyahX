-- =============================================================================
-- Quran & Ibtahalat Reel Maker - Full MySQL Database Schema
-- Charset: utf8mb4 (Full Unicode for Arabic Quranic Text, Surah and Reciter names)
-- Engine: InnoDB with Foreign Key constraints & Cascading Deletions
-- =============================================================================

-- 1. Users
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. User Profiles
CREATE TABLE IF NOT EXISTS `profiles` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `display_name` VARCHAR(255) DEFAULT NULL,
  `avatar_url` TEXT DEFAULT NULL,
  `bio` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_profiles_user_id` (`user_id`),
  CONSTRAINT `fk_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. User Roles (admin, moderator, user)
CREATE TABLE IF NOT EXISTS `user_roles` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `role` ENUM('admin', 'moderator', 'user') NOT NULL DEFAULT 'user',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_role` (`user_id`, `role`),
  CONSTRAINT `fk_user_roles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Saved Videos
CREATE TABLE IF NOT EXISTS `saved_videos` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `surah_name` VARCHAR(100) NOT NULL,
  `surah_number` INT NOT NULL,
  `start_ayah` INT NOT NULL,
  `end_ayah` INT NOT NULL,
  `reciter_id` VARCHAR(100) NOT NULL,
  `reciter_name` VARCHAR(150) NOT NULL,
  `video_url` TEXT DEFAULT NULL,
  `thumbnail_url` TEXT DEFAULT NULL,
  `aspect_ratio` VARCHAR(20) NOT NULL DEFAULT '9:16',
  `background_type` VARCHAR(50) NOT NULL DEFAULT 'color',
  `is_public` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `render_engine` VARCHAR(50) NOT NULL DEFAULT 'browser',
  PRIMARY KEY (`id`),
  INDEX `idx_saved_videos_user` (`user_id`),
  INDEX `idx_saved_videos_public` (`is_public`),
  INDEX `idx_saved_videos_created` (`created_at`),
  INDEX `idx_saved_videos_public_created` (`is_public`, `created_at` DESC),
  INDEX `idx_saved_videos_user_created` (`user_id`, `created_at` DESC),
  INDEX `idx_saved_videos_surah` (`surah_number`),
  INDEX `idx_saved_videos_reciter` (`reciter_id`),
  CONSTRAINT `fk_saved_videos_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Video Comments (Threaded with parent_id)
CREATE TABLE IF NOT EXISTS `video_comments` (
  `id` VARCHAR(36) NOT NULL,
  `video_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `parent_id` VARCHAR(36) DEFAULT NULL,
  `content` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_comments_video` (`video_id`),
  INDEX `idx_comments_parent` (`parent_id`),
  INDEX `idx_comments_video_created` (`video_id`, `created_at` ASC),
  CONSTRAINT `fk_comments_video` FOREIGN KEY (`video_id`) REFERENCES `saved_videos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_comments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_comments_parent` FOREIGN KEY (`parent_id`) REFERENCES `video_comments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Video Likes
CREATE TABLE IF NOT EXISTS `video_likes` (
  `id` VARCHAR(36) NOT NULL,
  `video_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_video_like` (`user_id`, `video_id`),
  INDEX `idx_video_likes_video` (`video_id`),
  INDEX `idx_video_likes_user` (`user_id`),
  CONSTRAINT `fk_video_likes_video` FOREIGN KEY (`video_id`) REFERENCES `saved_videos` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_video_likes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. User Follows
CREATE TABLE IF NOT EXISTS `user_follows` (
  `id` VARCHAR(36) NOT NULL,
  `follower_id` VARCHAR(36) NOT NULL,
  `following_id` VARCHAR(36) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_follow` (`follower_id`, `following_id`),
  INDEX `idx_user_follows_following` (`following_id`),
  CONSTRAINT `fk_follows_follower` FOREIGN KEY (`follower_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_follows_following` FOREIGN KEY (`following_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Subscriptions
CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `plan` ENUM('free', 'monthly', 'yearly') NOT NULL DEFAULT 'free',
  `status` ENUM('active', 'expired', 'canceled') NOT NULL DEFAULT 'active',
  `starts_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_subscriptions_user` (`user_id`, `status`),
  INDEX `idx_subscriptions_status_expires` (`status`, `expires_at`),
  CONSTRAINT `fk_subscriptions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Payment Requests
CREATE TABLE IF NOT EXISTS `payment_requests` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `plan` VARCHAR(50) NOT NULL,
  `amount` DECIMAL(10, 2) NOT NULL,
  `currency` CHAR(3) NOT NULL DEFAULT 'EGP',
  `payment_method` VARCHAR(50) NOT NULL,
  `phone_number` VARCHAR(50) NOT NULL,
  `transfer_reference` VARCHAR(100) DEFAULT NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `admin_note` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_payment_status` (`status`),
  INDEX `idx_payment_user` (`user_id`),
  CONSTRAINT `fk_payment_requests_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. Daily Video Usage Tracker
CREATE TABLE IF NOT EXISTS `daily_video_usage` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `count` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_daily_usage` (`user_id`, `date`),
  INDEX `idx_daily_usage_date` (`date`),
  CONSTRAINT `fk_daily_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10b. Atomic per-user/day cloud-render allowance. A render slot is claimed
-- when a job is accepted, so cancelling/retrying jobs cannot bypass 1/15/25.
CREATE TABLE IF NOT EXISTS `daily_cloud_render_usage` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `date` DATE NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cloud_render_usage_user_date` (`user_id`, `date`),
  INDEX `idx_cloud_render_usage_date` (`date`),
  CONSTRAINT `fk_cloud_render_usage_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. Achievements Catalog
CREATE TABLE IF NOT EXISTS `achievements` (
  `id` VARCHAR(36) NOT NULL,
  `key` VARCHAR(100) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT NOT NULL,
  `icon` VARCHAR(100) NOT NULL DEFAULT 'trophy',
  `category` VARCHAR(100) NOT NULL DEFAULT 'general',
  `threshold` INT NOT NULL DEFAULT 1,
  `points` INT NOT NULL DEFAULT 10,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_achievements_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. User Achievements
CREATE TABLE IF NOT EXISTS `user_achievements` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `achievement_id` VARCHAR(36) NOT NULL,
  `unlocked_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_achievement` (`user_id`, `achievement_id`),
  CONSTRAINT `fk_user_achievements_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_user_achievements_item` FOREIGN KEY (`achievement_id`) REFERENCES `achievements` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. Favorite Surahs
CREATE TABLE IF NOT EXISTS `favorite_surahs` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `surah_number` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_surah` (`user_id`, `surah_number`),
  CONSTRAINT `fk_favorite_surahs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. Favorite Reciters
CREATE TABLE IF NOT EXISTS `favorite_reciters` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `reciter_id` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_reciter` (`user_id`, `reciter_id`),
  CONSTRAINT `fk_favorite_reciters_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. Favorite Performers (Ibtahalat)
CREATE TABLE IF NOT EXISTS `favorite_performers` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `performer_id` VARCHAR(100) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_performer` (`user_id`, `performer_id`),
  CONSTRAINT `fk_favorite_performers_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. Notifications
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `message` TEXT NOT NULL,
  `type` VARCHAR(50) NOT NULL DEFAULT 'system',
  `is_read` BOOLEAN NOT NULL DEFAULT FALSE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_notifications_user` (`user_id`, `is_read`),
  INDEX `idx_notifications_user_created` (`user_id`, `created_at` DESC),
  CONSTRAINT `fk_notifications_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. Durable Render Jobs
CREATE TABLE IF NOT EXISTS `render_jobs` (
  `id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `idempotency_key` VARCHAR(128) DEFAULT NULL,
  `status` ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  `progress` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  `stage` VARCHAR(100) NOT NULL DEFAULT 'queued',
  `manifest` JSON NOT NULL,
  `output_path` TEXT DEFAULT NULL,
  `output_filename` VARCHAR(255) DEFAULT NULL,
  `output_size_bytes` BIGINT DEFAULT NULL,
  `duration_seconds` DECIMAL(7, 2) DEFAULT NULL,
  `metadata` JSON DEFAULT NULL,
  `error_code` VARCHAR(50) DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `retry_count` INT NOT NULL DEFAULT 0,
  `max_retries` INT NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `started_at` TIMESTAMP NULL DEFAULT NULL,
  `completed_at` TIMESTAMP NULL DEFAULT NULL,
  `expires_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_render_jobs_idempotency` (`idempotency_key`),
  INDEX `idx_render_jobs_user` (`user_id`, `created_at` DESC),
  INDEX `idx_render_jobs_status` (`status`, `created_at` ASC),
  CONSTRAINT `fk_render_jobs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. System Settings & API Keys
CREATE TABLE IF NOT EXISTS `system_settings` (
  `key_name` VARCHAR(100) NOT NULL,
  `value_text` TEXT NOT NULL,
  `is_secret` BOOLEAN NOT NULL DEFAULT FALSE,
  `category` VARCHAR(50) NOT NULL DEFAULT 'general',
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =============================================================================
-- Default Seed Data
-- =============================================================================

INSERT INTO `achievements` (`id`, `key`, `title`, `description`, `icon`, `category`, `threshold`, `points`) VALUES
  (UUID(), 'first_video', 'الخطوة الأولى', 'أنشئ أول فيديو لك', 'video', 'videos', 1, 10),
  (UUID(), 'five_videos', 'منتج نشط', 'أنشئ 5 فيديوهات', 'video', 'videos', 5, 25),
  (UUID(), 'twenty_videos', 'صانع محتوى', 'أنشئ 20 فيديو', 'video', 'videos', 20, 50),
  (UUID(), 'fifty_videos', 'خبير الفيديو', 'أنشئ 50 فيديو', 'trophy', 'videos', 50, 100),
  (UUID(), 'hundred_videos', 'أسطورة المحتوى', 'أنشئ 100 فيديو', 'crown', 'videos', 100, 200),
  (UUID(), 'first_favorite', 'محب القرآن', 'أضف أول سورة مفضلة', 'heart', 'engagement', 1, 10),
  (UUID(), 'five_favorites', 'عاشق السور', 'أضف 5 سور مفضلة', 'heart', 'engagement', 5, 25),
  (UUID(), 'five_reciters', 'متذوق التلاوة', 'استخدم 5 قراء مختلفين', 'mic', 'exploration', 5, 30),
  (UUID(), 'ten_surahs', 'مستكشف السور', 'أنشئ فيديوهات من 10 سور مختلفة', 'book-open', 'exploration', 10, 40),
  (UUID(), 'premium_member', 'عضو مميز', 'اشترك في الخطة المميزة', 'crown', 'membership', 1, 50)
ON DUPLICATE KEY UPDATE `title` = VALUES(`title`);
