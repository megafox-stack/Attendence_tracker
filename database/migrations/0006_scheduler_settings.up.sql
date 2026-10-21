-- Per-account opt-in for server-side daily occurrence generation.
CREATE TABLE scheduler_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_run_at DATETIME(3) NULL COMMENT 'UTC; most recent completed check by the scheduler worker.',
    last_run_date DATE NULL COMMENT 'Local date last processed for this user.',
    last_error VARCHAR(500) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_scheduler_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
