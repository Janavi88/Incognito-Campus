-- Incognito Campus: query examples and read-only integrity checks.
-- Run after schema.sql, seed.sql, and the migrations.

-- 1. Recent doubts with subject, topic, public author, tags, answers, and vote total.
WITH answer_counts AS (
    SELECT post_id, count(*) AS answer_count
      FROM answer
     GROUP BY post_id
), post_vote_totals AS (
    SELECT post_id, sum(vote_value) AS vote_score
      FROM votes
     WHERE post_id IS NOT NULL
     GROUP BY post_id
), post_tags AS (
    SELECT pt.post_id, string_agg(t.tag_name, ', ' ORDER BY t.tag_name) AS tags
      FROM post_tag pt
      JOIN tag t ON t.tag_id = pt.tag_id
     GROUP BY pt.post_id
)
SELECT p.post_id,
       p.title,
       s.subject_code,
       s.subject_name,
       tp.topic_name,
       CASE u.role
           WHEN 'student' THEN st.anonymous_handle
           WHEN 'teacher' THEN tr.display_name
           ELSE 'Admin'
       END AS public_author,
       p.status,
       COALESCE(ac.answer_count, 0) AS answer_count,
       COALESCE(pvt.vote_score, 0) AS vote_score,
       COALESCE(pt.tags, '') AS tags,
       p.created_at
  FROM post p
  JOIN subject s ON s.subject_id = p.subject_id
  LEFT JOIN topic tp ON tp.subject_id = p.subject_id AND tp.topic_name = p.topic_name
  JOIN users u ON u.user_id = p.user_id
  LEFT JOIN student st ON st.user_id = u.user_id
  LEFT JOIN teacher tr ON tr.user_id = u.user_id
  LEFT JOIN answer_counts ac ON ac.post_id = p.post_id
  LEFT JOIN post_vote_totals pvt ON pvt.post_id = p.post_id
  LEFT JOIN post_tags pt ON pt.post_id = p.post_id
 ORDER BY p.created_at DESC;

-- 2. Answers on one doubt, with public author name, comments, and answer vote total.
-- Replace the UUID with a post_id from the database.
SELECT a.answer_id,
       a.body,
       a.is_accepted,
       CASE u.role
           WHEN 'student' THEN st.anonymous_handle
           WHEN 'teacher' THEN tr.display_name
           ELSE 'Admin'
       END AS public_author,
       count(DISTINCT c.comment_id) AS comment_count,
       COALESCE((SELECT sum(v.vote_value)
                   FROM votes v
                  WHERE v.answer_id = a.answer_id), 0) AS vote_score
  FROM answer a
  JOIN users u ON u.user_id = a.user_id
  LEFT JOIN student st ON st.user_id = u.user_id
  LEFT JOIN teacher tr ON tr.user_id = u.user_id
  LEFT JOIN comment c ON c.answer_id = a.answer_id
 WHERE a.post_id = '40000000-0000-0000-0000-000000000001'
 GROUP BY a.answer_id, a.body, a.is_accepted, u.role, st.anonymous_handle, tr.display_name
 ORDER BY a.is_accepted DESC, vote_score DESC, a.created_at;

-- 3. Open, unanswered doubts in subjects taught by one teacher.
-- Replace FAC001 with the teacher's user_id.
SELECT p.post_id, p.title, s.subject_code, s.subject_name, p.created_at
  FROM teaches teach
  JOIN post p ON p.subject_id = teach.subject_id
  JOIN subject s ON s.subject_id = p.subject_id
 WHERE teach.user_id = 'FAC001'
   AND p.status = 'open'
   AND NOT EXISTS (SELECT 1 FROM answer a WHERE a.post_id = p.post_id)
 ORDER BY p.created_at;

-- 4. Doubt volume and resolution percentage by subject.
SELECT s.subject_code,
       s.subject_name,
       count(p.post_id) AS total_doubts,
       count(p.post_id) FILTER (WHERE p.status = 'open') AS open_doubts,
       count(p.post_id) FILTER (WHERE p.status = 'resolved') AS resolved_doubts,
       round(100.0 * count(p.post_id) FILTER (WHERE p.status = 'resolved')
                    / NULLIF(count(p.post_id), 0), 1) AS resolved_percent
  FROM subject s
  LEFT JOIN post p ON p.subject_id = s.subject_id
 GROUP BY s.subject_id, s.subject_code, s.subject_name
 ORDER BY total_doubts DESC, s.subject_code;

-- 5. Most-used tags.
SELECT t.tag_name,
       count(*) AS doubt_count,
       count(*) FILTER (WHERE p.status = 'resolved') AS resolved_count
  FROM tag t
  JOIN post_tag pt ON pt.tag_id = t.tag_id
  JOIN post p ON p.post_id = pt.post_id
 GROUP BY t.tag_id, t.tag_name
 ORDER BY doubt_count DESC, t.tag_name;

-- 6. Integrity checks: each query should return zero rows.
-- Votes must target exactly one of a post or an answer.
SELECT vote_id, user_id, post_id, answer_id
  FROM votes
 WHERE (post_id IS NULL) = (answer_id IS NULL);

-- A comment's post_id must match the post that owns its answer.
SELECT c.comment_id, c.post_id AS comment_post_id, a.post_id AS answer_post_id
  FROM comment c
  JOIN answer a ON a.answer_id = c.answer_id
 WHERE c.post_id <> a.post_id;

-- Index-plan examples for common lookups.
EXPLAIN SELECT post_id, title, created_at
          FROM post
         WHERE subject_id = 'SUB001' AND topic_name = 'Normalization';

EXPLAIN SELECT answer_id, body, created_at
          FROM answer
         WHERE post_id = '40000000-0000-0000-0000-000000000001';
