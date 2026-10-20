-- Attendance Tracker — migration 0004; requires migration 0001 and MySQL 8.0.16+.
-- Store only SHA-256 digests of opaque session tokens; raw tokens are returned once to the client.
CREATE TABLE user_sessions (
    token_hash BINARY(32) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME(3) NOT NULL COMMENT 'UTC.',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'UTC.',
    PRIMARY KEY (token_hash),
    KEY ix_user_sessions_user_expiry (user_id, expires_at),
    KEY ix_user_sessions_expiry (expires_at),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id)
        ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
