-- queries/explain_demo.sql: EXPLAIN ANALYZE for the dashboard queries that depend on indexes.
-- Demo flow:  1) load bulk data (tests/bulk_data.sql)   2) run this file  ("BEFORE")
--             3) apply migrations/003_dashboards_indexes.sql, run ANALYZE;   4) run this file again ("AFTER")
-- Same queries as dashboards.sql, with :days = 90 and :unanswered_hours = 48 filled in.

\echo '##### D1 pending report queue (first 50) #####'
EXPLAIN (ANALYZE, BUFFERS)
SELECT r.report_id, r.reason, r.created_at
  FROM report r
 WHERE r.status = 'pending'
 ORDER BY r.created_at ASC
 LIMIT 50;

\echo '##### D2a most-reported posts: join first (slow shape) #####'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.post_id, p.title, count(*) AS total_reports,
       count(*) FILTER (WHERE r.status = 'pending') AS pending
  FROM report r
  JOIN post p ON p.post_id = r.post_id
 GROUP BY p.post_id, p.title
 ORDER BY total_reports DESC, pending DESC
 LIMIT 10;

\echo '##### D2b most-reported posts: aggregate first (used in dashboards.sql) #####'
EXPLAIN (ANALYZE, BUFFERS)
WITH top AS (
    SELECT post_id, count(*) AS total_reports,
           count(*) FILTER (WHERE status = 'pending') AS pending
      FROM report
     WHERE post_id IS NOT NULL
     GROUP BY post_id
     ORDER BY total_reports DESC, pending DESC
     LIMIT 10
)
SELECT p.post_id, p.title, t.total_reports, t.pending
  FROM top t
  JOIN post p ON p.post_id = t.post_id
 ORDER BY t.total_reports DESC, t.pending DESC;

\echo '##### D3 reports by subject #####'
EXPLAIN (ANALYZE, BUFFERS)
SELECT s.subject_code, count(*) AS reports,
       count(*) FILTER (WHERE r.status = 'pending') AS pending
  FROM report r
  LEFT JOIN answer a ON a.answer_id = r.answer_id
  JOIN post p        ON p.post_id   = COALESCE(r.post_id, a.post_id)
  JOIN subject s     ON s.subject_id = p.subject_id
 GROUP BY s.subject_code
 ORDER BY reports DESC;

\echo '##### D4 trending topics (last 90 days) #####'
EXPLAIN (ANALYZE, BUFFERS)
SELECT subject_id, topic_name, count(*) AS new_doubts
  FROM post
 WHERE created_at >= now() - 90 * interval '1 day'
   AND merged_into IS NULL
   AND topic_name IS NOT NULL
 GROUP BY subject_id, topic_name
 ORDER BY new_doubts DESC
 LIMIT 10;

\echo '##### D5 aging unanswered doubts #####'
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.subject_id, count(*) AS unanswered, min(p.created_at) AS oldest
  FROM post p
 WHERE p.status = 'open'
   AND p.merged_into IS NULL
   AND p.created_at < now() - 48 * interval '1 hour'
   AND NOT EXISTS (SELECT 1 FROM answer a WHERE a.post_id = p.post_id)
 GROUP BY p.subject_id
 ORDER BY unanswered DESC;