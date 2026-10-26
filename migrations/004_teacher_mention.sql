-- 004_teacher_mention.sql: Add teacher mention reference to doubts
BEGIN;

ALTER TABLE post ADD COLUMN IF NOT EXISTS mentioned_teacher_id VARCHAR(20) REFERENCES teacher (user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_mentioned_teacher ON post (mentioned_teacher_id) WHERE mentioned_teacher_id IS NOT NULL;

COMMIT;
