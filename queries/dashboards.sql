-- queries/dashboards.sql  (Janavi: moderation + analytics dashboards)
-- Read-only. Run after schema.sql, seed.sql, 001 and 002:
--   psql -U postgres -d incognito_campus -f queries/dashboards.sql
-- (Diya's queries.sql has the student feed / per-teacher / per-subject queries; these are the
--  admin/teacher analytics and moderation side.)

\set days 90
\set unanswered_hours 48

-- ---------------------------------------------------------------------
-- D1. Review queue: pending reports, oldest first
-- ---------------------------------------------------------------------
\echo '=== D1. Pending report queue (oldest first) ==='
SELECT r.report_id,
       CASE WHEN r.post_id IS NOT NULL THEN 'post' ELSE 'answer' END AS target_type,
       COALESCE(p.title, left(a.body, 80))                          AS preview,
       r.reason,
       r.created_at,
       now() - r.created_at                                          AS waiting
  FROM report r
  LEFT JOIN post   p ON p.post_id   = r.post_id
  LEFT JOIN answer a ON a.answer_id = r.answer_id
 WHERE r.status = 'pending'
 ORDER BY r.created_at ASC;

-- ---------------------------------------------------------------------
-- D2. Most-reported content (posts and answers together)
-- ---------------------------------------------------------------------
\echo '=== D2. Most-reported content ==='
-- Aggregate the reports FIRST and keep only the top 10 per kind, then join to post/answer.
-- (Joining 100k posts before aggregating was ~7x slower: 47 ms vs 6.5 ms in testing.)
WITH rp AS (
    SELECT post_id, count(*) AS total_reports,
           count(*) FILTER (WHERE status = 'pending')  AS pending,
           count(*) FILTER (WHERE status = 'actioned') AS actioned
      FROM report
     WHERE post_id IS NOT NULL
     GROUP BY post_id
     ORDER BY total_reports DESC, pending DESC
     LIMIT 10
), ra AS (
    SELECT answer_id, count(*) AS total_reports,
           count(*) FILTER (WHERE status = 'pending')  AS pending,
           count(*) FILTER (WHERE status = 'actioned') AS actioned
      FROM report
     WHERE answer_id IS NOT NULL
     GROUP BY answer_id
     ORDER BY total_reports DESC, pending DESC
     LIMIT 10
)
SELECT kind, target_id, preview, total_reports, pending, actioned
  FROM (
        SELECT 'post' AS kind, p.post_id AS target_id, p.title AS preview,
               rp.total_reports, rp.pending, rp.actioned
          FROM rp JOIN post p ON p.post_id = rp.post_id
        UNION ALL
        SELECT 'answer', a.answer_id, left(a.body, 80),
               ra.total_reports, ra.pending, ra.actioned
          FROM ra JOIN answer a ON a.answer_id = ra.answer_id
       ) u
 ORDER BY total_reports DESC, pending DESC
 LIMIT 10;

-- ---------------------------------------------------------------------
-- D3. Moderation load by subject
-- ---------------------------------------------------------------------
\echo '=== D3. Reports by subject ==='
SELECT s.subject_code,
       count(*)                                          AS reports,
       count(*) FILTER (WHERE r.status = 'pending')      AS pending,
       count(*) FILTER (WHERE r.status = 'actioned')     AS actioned,
       count(*) FILTER (WHERE r.status = 'dismissed')    AS dismissed
  FROM report r
  LEFT JOIN answer a ON a.answer_id = r.answer_id
  JOIN post p        ON p.post_id   = COALESCE(r.post_id, a.post_id)
  JOIN subject s     ON s.subject_id = p.subject_id
 GROUP BY s.subject_code
 ORDER BY reports DESC;

-- ---------------------------------------------------------------------
-- D4. Trending topics in the last :days days
--     (new doubts, answers received, net votes; merged duplicates excluded)
-- ---------------------------------------------------------------------
\echo '=== D4. Trending topics ==='
WITH recent AS (
    SELECT post_id, subject_id, topic_name
      FROM post
     WHERE created_at >= now() - :days * interval '1 day'
       AND merged_into IS NULL
       AND topic_name IS NOT NULL
), ans AS (
    SELECT a.post_id, count(*) AS n
      FROM answer a JOIN recent r ON r.post_id = a.post_id
     GROUP BY a.post_id
), vt AS (
    SELECT v.post_id, sum(v.vote_value) AS s
      FROM votes v JOIN recent r ON r.post_id = v.post_id
     GROUP BY v.post_id
)
SELECT s.subject_code, r.topic_name,
       count(*)                        AS new_doubts,
       COALESCE(sum(ans.n), 0)         AS answers,
       COALESCE(sum(vt.s), 0)          AS post_votes
  FROM recent r
  JOIN subject s ON s.subject_id = r.subject_id
  LEFT JOIN ans  ON ans.post_id = r.post_id
  LEFT JOIN vt   ON vt.post_id  = r.post_id
 GROUP BY s.subject_code, r.topic_name
 ORDER BY new_doubts DESC, answers DESC
 LIMIT 10;

-- ---------------------------------------------------------------------
-- D5. Knowledge gaps: open doubts with NO answer for more than :unanswered_hours hours
-- ---------------------------------------------------------------------
\echo '=== D5. Aging unanswered doubts by subject ==='
SELECT s.subject_code, s.subject_name,
       count(*)                                                       AS unanswered,
       min(p.created_at)                                              AS oldest,
       round(extract(epoch FROM now() - min(p.created_at)) / 3600)    AS oldest_wait_hours
  FROM post p
  JOIN subject s ON s.subject_id = p.subject_id
 WHERE p.status = 'open'
   AND p.merged_into IS NULL
   AND p.created_at < now() - :unanswered_hours * interval '1 hour'
   AND NOT EXISTS (SELECT 1 FROM answer a WHERE a.post_id = p.post_id)
 GROUP BY s.subject_code, s.subject_name
 ORDER BY unanswered DESC;

-- ---------------------------------------------------------------------
-- D6. Duplicate hot-spots: threads that absorbed the most merged duplicates
-- ---------------------------------------------------------------------
\echo '=== D6. Duplicate hot-spots ==='
SELECT o.post_id, o.title, s.subject_code,
       count(d.post_id) AS merged_duplicates
  FROM post o
  JOIN post d    ON d.merged_into = o.post_id
  JOIN subject s ON s.subject_id  = o.subject_id
 GROUP BY o.post_id, o.title, s.subject_code
 ORDER BY merged_duplicates DESC
 LIMIT 10;

-- ---------------------------------------------------------------------
-- D7. Embedding health: posts that still need an embedding (the retry list)
-- ---------------------------------------------------------------------
\echo '=== D7. Posts missing an embedding ==='
SELECT p.post_id, p.title, p.created_at
  FROM post p
  LEFT JOIN post_embeddings e ON e.post_id = p.post_id
 WHERE (e.post_id IS NULL OR e.embedding IS NULL)
   AND p.merged_into IS NULL
 ORDER BY p.created_at;

-- ---------------------------------------------------------------------
-- D8. Top answerers by accepted answers. Public names only: students stay anonymous.
-- ---------------------------------------------------------------------
\echo '=== D8. Top answerers ==='
WITH answer_votes AS (
    SELECT answer_id, sum(vote_value) AS s
      FROM votes WHERE answer_id IS NOT NULL
     GROUP BY answer_id
)
SELECT CASE u.role WHEN 'student' THEN st.anonymous_handle
                   WHEN 'teacher' THEN tr.display_name
                   ELSE 'Admin' END                     AS public_author,
       u.role,
       count(*)                                         AS answers,
       count(*) FILTER (WHERE a.is_accepted)            AS accepted,
       COALESCE(sum(av.s), 0)                           AS net_votes
  FROM answer a
  JOIN users u            ON u.user_id = a.user_id
  LEFT JOIN student st    ON st.user_id = u.user_id
  LEFT JOIN teacher tr    ON tr.user_id = u.user_id
  LEFT JOIN answer_votes av ON av.answer_id = a.answer_id
 GROUP BY u.user_id, u.role, st.anonymous_handle, tr.display_name
 ORDER BY accepted DESC, net_votes DESC
 LIMIT 10;