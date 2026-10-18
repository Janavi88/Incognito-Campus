
-- 001_search_moderation.sql  
-- Run AFTER schema.sql and seed.SQL. Once Diya agrees, fold these into schema.sql.
BEGIN;

-- 1. post_embeddings is a weak entity of post: post_id must be its primary key
ALTER TABLE post_embeddings ADD PRIMARY KEY (post_id);

-- 2. Merge workflow: a duplicate points at the post it was merged into.
--    Convention: merged post gets status = 'closed' AND merged_into set.
ALTER TABLE post ADD COLUMN merged_into UUID REFERENCES post (post_id) ON DELETE SET NULL;
ALTER TABLE post ADD CONSTRAINT chk_no_self_merge
    CHECK (merged_into IS NULL OR merged_into <> post_id);
CREATE INDEX idx_post_merged_into ON post (merged_into) WHERE merged_into IS NOT NULL;

-- 3. Reports: one report per user per target, and reviewer is set iff not pending
CREATE UNIQUE INDEX uq_report_user_post   ON report (reporter_user_id, post_id)   WHERE post_id   IS NOT NULL;
CREATE UNIQUE INDEX uq_report_user_answer ON report (reporter_user_id, answer_id) WHERE answer_id IS NOT NULL;
ALTER TABLE report ADD CONSTRAINT chk_reviewer_matches_status
    CHECK ((status = 'pending') = (reviewer_user_id IS NULL));

COMMIT;