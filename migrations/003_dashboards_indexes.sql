-- 003_dashboards_indexes.sql  (Janavi: indexes for the dashboards)
-- Run after 001 and 002. Each index below was measured with EXPLAIN ANALYZE on ~100k posts,
-- ~250k answers, ~20k reports (tests/bulk_data.sql) and kept only because it made a real difference.

-- D1 review queue: "pending reports, oldest first".
-- Tiny partial index: contains ONLY pending reports, already sorted by date.
-- Measured 1.35 ms -> 0.19 ms (and it stays fast as decided reports pile up).
CREATE INDEX IF NOT EXISTS idx_report_pending_created
    ON report (created_at)
 WHERE status = 'pending';

-- D4 trending topics: "posts from the last N days, grouped by subject/topic".
-- Covering partial index: the date range AND the grouping columns come from the index alone
-- (index-only scan), and merged duplicates are left out.
-- Measured 26 ms -> 7 ms. Needs a recent VACUUM for index-only scans.
CREATE INDEX IF NOT EXISTS idx_post_recent_unmerged
    ON post (created_at DESC) INCLUDE (subject_id, topic_name)
 WHERE merged_into IS NULL;

-- Tested and deliberately NOT added (no meaningful gain in EXPLAIN ANALYZE):
--   report (post_id) / (answer_id)                  -> D2/D3 improved <10%
--   partial index on open, unmerged posts           -> D5 improved ~20%, not worth the write cost
-- D2 was fixed by rewriting the query (aggregate first, join after): 47 ms -> 6.5 ms, no index needed.