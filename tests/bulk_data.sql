-- tests/bulk_data.sql: generate a large fake dataset so EXPLAIN ANALYZE shows real index effects.
-- Run AFTER schema.sql, seed.sql, 001, 002. ~100k posts, ~250k answers, ~350k votes, ~20k reports.
-- Takes under a minute. To remove it all again, reload schema + seed + 001 + 002 (or run the cleanup at the bottom).
\timing on
BEGIN;

-- the report trigger checks every row; skip it for the bulk load only
ALTER TABLE report DISABLE TRIGGER report_rules;

-- 2000 fake students
INSERT INTO users (user_id, email, password_hash, role, department)
SELECT 'BULK' || lpad(g::text, 5, '0'), 'bulk' || g || '@campus.edu', 'dummy', 'student', 'Computer Science'
  FROM generate_series(1, 2000) g;
INSERT INTO student (user_id, anonymous_handle)
SELECT 'BULK' || lpad(g::text, 5, '0'), 'BulkUser' || g
  FROM generate_series(1, 2000) g;

-- 100,000 posts spread over 400 days, random topic, ~30% open / 55% resolved / 15% closed
WITH t AS (
    SELECT subject_id, topic_name, row_number() OVER (ORDER BY subject_id, topic_name) AS rn FROM topic
)
INSERT INTO post (user_id, subject_id, topic_name, title, body, status, created_at)
SELECT x.uid, t.subject_id, t.topic_name, 'Bulk doubt ' || x.g, 'Body of bulk doubt ' || x.g,
       CASE WHEN x.r < 0.30 THEN 'open' WHEN x.r < 0.85 THEN 'resolved' ELSE 'closed' END,
       now() - x.d * interval '400 days'
  FROM (SELECT g, random() AS r, random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               1 + floor(random() * (SELECT count(*) FROM topic))::int AS k
          FROM generate_series(1, 100000) g) x
  JOIN t ON t.rn = x.k;

CREATE TEMP TABLE bulk_posts AS
SELECT post_id, row_number() OVER (ORDER BY post_id) AS rn FROM post WHERE user_id LIKE 'BULK%';

-- ~5% of the later posts become merged duplicates of one of the first 10,000
UPDATE post p
   SET status = 'closed', merged_into = o.post_id
  FROM bulk_posts d
  JOIN bulk_posts o ON o.rn = 1 + (d.rn % 10000)
 WHERE p.post_id = d.post_id AND d.rn > 10000 AND d.rn % 20 = 0;

-- 250,000 answers, ~15% accepted
INSERT INTO answer (post_id, user_id, body, is_accepted, created_at)
SELECT bp.post_id, x.uid, 'Bulk answer ' || x.g, x.acc, now() - x.d * interval '390 days'
  FROM (SELECT g, random() < 0.15 AS acc, random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               1 + floor(random() * 100000)::int AS k
          FROM generate_series(1, 250000) g) x
  JOIN bulk_posts bp ON bp.rn = x.k;

CREATE TEMP TABLE bulk_answers AS
SELECT answer_id, row_number() OVER (ORDER BY answer_id) AS rn FROM answer WHERE body LIKE 'Bulk answer%';

-- 250,000 answer votes + 100,000 post votes (duplicates of the same user+target are skipped)
INSERT INTO votes (user_id, answer_id, vote_value, created_at)
SELECT x.uid, ba.answer_id, CASE WHEN x.r < 0.8 THEN 1 ELSE -1 END, now() - x.d * interval '300 days'
  FROM (SELECT random() AS r, random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               1 + floor(random() * 250000)::int AS k
          FROM generate_series(1, 250000)) x
  JOIN bulk_answers ba ON ba.rn = x.k
ON CONFLICT DO NOTHING;

INSERT INTO votes (user_id, post_id, vote_value, created_at)
SELECT x.uid, bp.post_id, CASE WHEN x.r < 0.8 THEN 1 ELSE -1 END, now() - x.d * interval '300 days'
  FROM (SELECT random() AS r, random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               1 + floor(random() * 100000)::int AS k
          FROM generate_series(1, 100000)) x
  JOIN bulk_posts bp ON bp.rn = x.k
ON CONFLICT DO NOTHING;

-- 20,000 reports (skewed so some posts/answers get reported many times), ~10% pending
INSERT INTO report (reporter_user_id, reviewer_user_id, post_id, reason, status, created_at)
SELECT x.uid, CASE WHEN x.st = 'pending' THEN NULL ELSE 'ADMIN001' END, bp.post_id, 'Bulk report', x.st,
       now() - x.d * interval '300 days'
  FROM (SELECT random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               CASE WHEN random() < 0.10 THEN 'pending' WHEN random() < 0.5 THEN 'actioned' ELSE 'dismissed' END AS st,
               1 + floor(power(random(), 3) * 100000)::int AS k
          FROM generate_series(1, 10000)) x
  JOIN bulk_posts bp ON bp.rn = x.k
ON CONFLICT DO NOTHING;

INSERT INTO report (reporter_user_id, reviewer_user_id, answer_id, reason, status, created_at)
SELECT x.uid, CASE WHEN x.st = 'pending' THEN NULL ELSE 'ADMIN001' END, ba.answer_id, 'Bulk report', x.st,
       now() - x.d * interval '300 days'
  FROM (SELECT random() AS d,
               'BULK' || lpad((1 + floor(random() * 2000))::int::text, 5, '0') AS uid,
               CASE WHEN random() < 0.10 THEN 'pending' WHEN random() < 0.5 THEN 'actioned' ELSE 'dismissed' END AS st,
               1 + floor(power(random(), 3) * 250000)::int AS k
          FROM generate_series(1, 10000)) x
  JOIN bulk_answers ba ON ba.rn = x.k
ON CONFLICT DO NOTHING;

ALTER TABLE report ENABLE TRIGGER report_rules;
COMMIT;

VACUUM ANALYZE;   -- refreshes statistics and the visibility map (needed for index-only scans)

SELECT 'posts' AS tbl, count(*) FROM post UNION ALL SELECT 'answers', count(*) FROM answer
UNION ALL SELECT 'votes', count(*) FROM votes UNION ALL SELECT 'reports', count(*) FROM report;

-- CLEANUP (only if you want to remove the fake data without reloading everything):
--   DELETE FROM report WHERE reporter_user_id LIKE 'BULK%';
--   DELETE FROM post   WHERE user_id LIKE 'BULK%';   -- cascades to answers, votes
--   DELETE FROM users  WHERE user_id LIKE 'BULK%';