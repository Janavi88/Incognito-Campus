
-- tests/test_edge_cases.sql  ( embeddings, votes, cascades, integrity)


\set QUIET on
\o /dev/null
BEGIN;

CREATE TEMP TABLE results (n serial, section text, test text, outcome text, detail text);

-- expect_error(section, test, sql, sqlstate): the statement MUST fail with that SQLSTATE
CREATE FUNCTION pg_temp.expect_error(p_sec text, p_test text, p_sql text, p_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    INSERT INTO results (section, test, outcome, detail)
    VALUES (p_sec, p_test, 'FAIL', 'statement succeeded but should have been rejected');
EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = p_state THEN
        INSERT INTO results (section, test, outcome, detail)
        VALUES (p_sec, p_test, 'PASS', 'rejected (' || SQLSTATE || '): ' || left(SQLERRM, 90));
    ELSE
        INSERT INTO results (section, test, outcome, detail)
        VALUES (p_sec, p_test, 'FAIL', 'wrong error ' || SQLSTATE || ': ' || left(SQLERRM, 90));
    END IF;
END $$;

-- expect_ok(section, test, sql): the statement MUST succeed
CREATE FUNCTION pg_temp.expect_ok(p_sec text, p_test text, p_sql text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    EXECUTE p_sql;
    INSERT INTO results (section, test, outcome, detail) VALUES (p_sec, p_test, 'PASS', 'accepted');
EXCEPTION WHEN OTHERS THEN
    INSERT INTO results (section, test, outcome, detail)
    VALUES (p_sec, p_test, 'FAIL', 'rejected (' || SQLSTATE || '): ' || left(SQLERRM, 90));
END $$;

-- check(section, test, condition, detail_if_pass, outcome_if_false)
CREATE FUNCTION pg_temp.chk(p_sec text, p_test text, p_ok boolean, p_detail text, p_bad text DEFAULT 'FAIL')
RETURNS void LANGUAGE sql AS $$
    INSERT INTO results (section, test, outcome, detail)
    VALUES (p_sec, p_test, CASE WHEN p_ok THEN 'PASS' ELSE p_bad END, p_detail);
$$;

-- a dummy 384-dimension vector, so we don't need the Python model for SQL-level tests
CREATE FUNCTION pg_temp.vec(p real) RETURNS vector LANGUAGE sql AS
$$ SELECT array_fill(p, ARRAY[384])::vector $$;

-- test fixtures: two posts by student AM001 (SUB001 / Normalization), one answer by AM002
INSERT INTO post (post_id, user_id, subject_id, topic_name, title, body) VALUES
 ('f0000000-0000-0000-0000-000000000001','PES1UG24AM001','SUB001','Normalization','TEST post one','body'),
 ('f0000000-0000-0000-0000-000000000002','PES1UG24AM001','SUB001','Normalization','TEST post two','body');
INSERT INTO answer (answer_id, post_id, user_id, body) VALUES
 ('f1000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','PES1UG24AM002','TEST answer 1a'),
 ('f1000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','PES1UG24CS001','TEST answer 1b'),
 ('f1000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000002','PES1UG24AM002','TEST answer 2a');

-- =====================================================================
-- A. EMBEDDING FAILURE AND RETRY
-- =====================================================================
-- A1. a brand-new post has no embedding, so it shows up in the retry list (query D7)
SELECT pg_temp.chk('A embeddings', 'New post without an embedding appears in the retry list',
  EXISTS (SELECT 1 FROM post p LEFT JOIN post_embeddings e ON e.post_id = p.post_id
           WHERE p.post_id = 'f0000000-0000-0000-0000-000000000001'
             AND (e.post_id IS NULL OR e.embedding IS NULL) AND p.merged_into IS NULL),
  'post 1 listed as missing an embedding');

-- A2. retry = the same upsert embed_posts.py uses; after it the post leaves the list
SELECT pg_temp.expect_ok('A embeddings', 'The retry upsert (ON CONFLICT) works the first time',
  $$INSERT INTO post_embeddings (post_id, embedding, embedding_model, embedding_updated_at)
    VALUES ('f0000000-0000-0000-0000-000000000001', pg_temp.vec(0.1), 'all-MiniLM-L6-v2', now())
    ON CONFLICT (post_id) DO UPDATE SET embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model, embedding_updated_at = EXCLUDED.embedding_updated_at$$);
SELECT pg_temp.chk('A embeddings', 'After the retry succeeds the post leaves the retry list',
  NOT EXISTS (SELECT 1 FROM post p LEFT JOIN post_embeddings e ON e.post_id = p.post_id
               WHERE p.post_id = 'f0000000-0000-0000-0000-000000000001'
                 AND (e.post_id IS NULL OR e.embedding IS NULL)),
  'post 1 no longer listed');

-- A3. retrying again must not create a second row (idempotent)
SELECT pg_temp.expect_ok('A embeddings', 'The retry upsert works again on the same post',
  $$INSERT INTO post_embeddings (post_id, embedding, embedding_model, embedding_updated_at)
    VALUES ('f0000000-0000-0000-0000-000000000001', pg_temp.vec(0.2), 'all-MiniLM-L6-v2', now())
    ON CONFLICT (post_id) DO UPDATE SET embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model, embedding_updated_at = EXCLUDED.embedding_updated_at$$);
SELECT pg_temp.chk('A embeddings', 'Retrying twice leaves exactly one embedding row',
  (SELECT count(*) FROM post_embeddings WHERE post_id = 'f0000000-0000-0000-0000-000000000001') = 1,
  'one row for post 1');

SELECT pg_temp.expect_error('A embeddings', 'Wrong vector size (3 instead of 384) is rejected',
  $$INSERT INTO post_embeddings VALUES ('f0000000-0000-0000-0000-000000000002','[1,2,3]','m',now())$$, '22000');
SELECT pg_temp.expect_error('A embeddings', 'Embedding without a model name is rejected (CHECK)',
  $$INSERT INTO post_embeddings (post_id, embedding, embedding_updated_at)
    VALUES ('f0000000-0000-0000-0000-000000000002', pg_temp.vec(0.3), now())$$, '23514');
SELECT pg_temp.expect_error('A embeddings', 'A second plain INSERT for the same post is rejected (primary key)',
  $$INSERT INTO post_embeddings VALUES ('f0000000-0000-0000-0000-000000000001', pg_temp.vec(0.4),'m',now())$$, '23505');
SELECT pg_temp.expect_error('A embeddings', 'Embedding for a post that does not exist is rejected (foreign key)',
  $$INSERT INTO post_embeddings VALUES ('f0000000-0000-0000-0000-0000000000ff', pg_temp.vec(0.4),'m',now())$$, '23503');

-- A8. a placeholder row with all three columns NULL is allowed, and the post still counts as "missing"
SELECT pg_temp.expect_ok('A embeddings', 'A placeholder row (all NULL) can be stored',
  $$INSERT INTO post_embeddings (post_id) VALUES ('f0000000-0000-0000-0000-000000000002')
    ON CONFLICT (post_id) DO NOTHING$$);
SELECT pg_temp.chk('A embeddings', 'Placeholder row (all NULL) still appears in the retry list',
  EXISTS (SELECT 1 FROM post p LEFT JOIN post_embeddings e ON e.post_id = p.post_id
           WHERE p.post_id = 'f0000000-0000-0000-0000-000000000002'
             AND (e.post_id IS NULL OR e.embedding IS NULL)),
  'post 2 listed even though a row exists');

-- =====================================================================
-- B. VOTING
-- =====================================================================
INSERT INTO votes (user_id, post_id, vote_value) VALUES ('PES1UG24AM003','f0000000-0000-0000-0000-000000000001', 1);
INSERT INTO votes (user_id, answer_id, vote_value) VALUES ('PES1UG24AM003','f1000000-0000-0000-0000-000000000001', 1);

SELECT pg_temp.expect_error('B votes', 'Same user cannot vote twice on the same post',
  $$INSERT INTO votes (user_id, post_id, vote_value) VALUES ('PES1UG24AM003','f0000000-0000-0000-0000-000000000001', -1)$$, '23505');
SELECT pg_temp.expect_error('B votes', 'Same user cannot vote twice on the same answer',
  $$INSERT INTO votes (user_id, answer_id, vote_value) VALUES ('PES1UG24AM003','f1000000-0000-0000-0000-000000000001', 1)$$, '23505');
SELECT pg_temp.expect_ok('B votes', 'Same user CAN vote on two different answers',
  $$INSERT INTO votes (user_id, answer_id, vote_value) VALUES ('PES1UG24AM003','f1000000-0000-0000-0000-000000000002', 1)$$);
SELECT pg_temp.expect_error('B votes', 'A vote on both a post and an answer is rejected',
  $$INSERT INTO votes (user_id, post_id, answer_id, vote_value)
    VALUES ('PES1UG24CS002','f0000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001', 1)$$, '23514');
SELECT pg_temp.expect_error('B votes', 'A vote on neither a post nor an answer is rejected',
  $$INSERT INTO votes (user_id, vote_value) VALUES ('PES1UG24CS002', 1)$$, '23514');
SELECT pg_temp.expect_error('B votes', 'A vote value other than +1 / -1 is rejected',
  $$INSERT INTO votes (user_id, post_id, vote_value) VALUES ('PES1UG24CS002','f0000000-0000-0000-0000-000000000001', 5)$$, '23514');

-- B7. changing a vote (what Diya's API does with ON CONFLICT) keeps a single row
SELECT pg_temp.expect_ok('B votes', 'Changing a vote via ON CONFLICT works',
  $$INSERT INTO votes (user_id, post_id, vote_value) VALUES ('PES1UG24AM003','f0000000-0000-0000-0000-000000000001', -1)
    ON CONFLICT (user_id, post_id) DO UPDATE SET vote_value = EXCLUDED.vote_value$$);
SELECT pg_temp.chk('B votes', 'Changing a vote updates the row instead of adding one',
  (SELECT count(*) FROM votes WHERE user_id='PES1UG24AM003' AND post_id='f0000000-0000-0000-0000-000000000001') = 1
  AND (SELECT vote_value FROM votes WHERE user_id='PES1UG24AM003' AND post_id='f0000000-0000-0000-0000-000000000001') = -1,
  'one row, value now -1');

-- B8. several accepted answers on one post are allowed (team decision: poster and teacher may each accept one)
UPDATE answer SET is_accepted = TRUE WHERE answer_id IN
 ('f1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002');
SELECT pg_temp.chk('B votes', 'A post can have two accepted answers (intended)',
  (SELECT count(*) FROM answer WHERE post_id='f0000000-0000-0000-0000-000000000001' AND is_accepted) = 2,
  'two accepted answers stored');

-- =====================================================================
-- C. MERGED POSTS AND SEARCH
-- =====================================================================
-- post 2 is a duplicate of post 1; give both the SAME vector so only the merge filter can separate them
UPDATE post_embeddings SET embedding = pg_temp.vec(0.5), embedding_model='m', embedding_updated_at = now()
 WHERE post_id IN ('f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002');
SELECT pg_temp.expect_ok('C merge', 'merge_post() merges the duplicate into the original',
  $$SELECT merge_post('f0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000001','ADMIN001')$$);
SELECT pg_temp.chk('C merge', 'A merged duplicate is excluded from similarity search',
  (SELECT count(*) FROM post_embeddings e JOIN post p ON p.post_id = e.post_id
    WHERE p.merged_into IS NULL
      AND e.post_id IN ('f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002')) = 1,
  'only the original comes back');
SELECT pg_temp.chk('C merge', 'The duplicate''s answer shows up under the original thread',
  EXISTS (SELECT 1 FROM v_thread_answers
           WHERE thread_post_id = 'f0000000-0000-0000-0000-000000000001'
             AND answer_id = 'f1000000-0000-0000-0000-000000000003' AND from_merged_duplicate),
  'answer 2a visible under post 1');

-- deleting the ORIGINAL leaves its duplicate behind, closed, with merged_into cleared
DELETE FROM post WHERE post_id = 'f0000000-0000-0000-0000-000000000001';
SELECT pg_temp.chk('C merge', 'Deleting the original keeps the duplicate (merged_into becomes NULL, stays closed)',
  EXISTS (SELECT 1 FROM post WHERE post_id='f0000000-0000-0000-0000-000000000002'
            AND merged_into IS NULL AND status='closed'),
  'duplicate survives as a closed post with no parent. Decide: reopen it, or block deleting merged originals.',
  'FAIL');
UPDATE results SET outcome = 'NOTE' WHERE test LIKE 'Deleting the original keeps%' AND outcome = 'PASS';

-- =====================================================================
-- D. CASCADE DELETE of a fully loaded post
-- =====================================================================
CREATE TEMP TABLE counts AS
SELECT 'baseline' AS stage,
  (SELECT count(*) FROM post)            AS post,   (SELECT count(*) FROM answer)          AS answer,
  (SELECT count(*) FROM comment)         AS comment,(SELECT count(*) FROM votes)           AS votes,
  (SELECT count(*) FROM report)          AS report, (SELECT count(*) FROM post_tag)        AS post_tag,
  (SELECT count(*) FROM post_embeddings) AS emb,    (SELECT count(*) FROM tag)             AS tag,
  (SELECT count(*) FROM users)           AS users;

INSERT INTO post (post_id, user_id, subject_id, topic_name, title, body) VALUES
 ('f0000000-0000-0000-0000-0000000000a1','PES1UG24AM001','SUB001','Transactions','CASCADE test post','body');
INSERT INTO answer (answer_id, post_id, user_id, body, is_accepted) VALUES
 ('f1000000-0000-0000-0000-0000000000a1','f0000000-0000-0000-0000-0000000000a1','PES1UG24AM002','a1', TRUE),
 ('f1000000-0000-0000-0000-0000000000a2','f0000000-0000-0000-0000-0000000000a1','PES1UG24CS001','a2', FALSE);
INSERT INTO comment (post_id, answer_id, user_id, body) VALUES
 ('f0000000-0000-0000-0000-0000000000a1','f1000000-0000-0000-0000-0000000000a1','PES1UG24CS002','c1');
INSERT INTO votes (user_id, post_id, vote_value)   VALUES ('PES1UG24AM003','f0000000-0000-0000-0000-0000000000a1', 1);
INSERT INTO votes (user_id, answer_id, vote_value) VALUES ('PES1UG24AM003','f1000000-0000-0000-0000-0000000000a1', 1);
INSERT INTO tag (tag_id, tag_name) VALUES ('f2000000-0000-0000-0000-0000000000a1','cascade-test-tag');
INSERT INTO post_tag VALUES ('f0000000-0000-0000-0000-0000000000a1','f2000000-0000-0000-0000-0000000000a1');
INSERT INTO report (reporter_user_id, post_id, reason)   VALUES ('PES1UG24AM003','f0000000-0000-0000-0000-0000000000a1','x');
INSERT INTO report (reporter_user_id, answer_id, reason) VALUES ('PES1UG24AM003','f1000000-0000-0000-0000-0000000000a1','y');
INSERT INTO post_embeddings VALUES ('f0000000-0000-0000-0000-0000000000a1', pg_temp.vec(0.7),'m',now());

INSERT INTO counts SELECT 'loaded',
  (SELECT count(*) FROM post),(SELECT count(*) FROM answer),(SELECT count(*) FROM comment),
  (SELECT count(*) FROM votes),(SELECT count(*) FROM report),(SELECT count(*) FROM post_tag),
  (SELECT count(*) FROM post_embeddings),(SELECT count(*) FROM tag),(SELECT count(*) FROM users);

DELETE FROM post WHERE post_id = 'f0000000-0000-0000-0000-0000000000a1';

INSERT INTO counts SELECT 'after delete',
  (SELECT count(*) FROM post),(SELECT count(*) FROM answer),(SELECT count(*) FROM comment),
  (SELECT count(*) FROM votes),(SELECT count(*) FROM report),(SELECT count(*) FROM post_tag),
  (SELECT count(*) FROM post_embeddings),(SELECT count(*) FROM tag),(SELECT count(*) FROM users);

SELECT pg_temp.chk('D cascade', 'Deleting a post removes its answers, comment, votes, reports, tag link and embedding',
  (SELECT (l.post-b.post)=1 AND (l.answer-b.answer)=2 AND (l.comment-b.comment)=1 AND (l.votes-b.votes)=2
          AND (l.report-b.report)=2 AND (l.post_tag-b.post_tag)=1 AND (l.emb-b.emb)=1
     FROM counts b, counts l WHERE b.stage='baseline' AND l.stage='loaded')
  AND
  (SELECT a.post=b.post+0 AND a.answer=b.answer AND a.comment=b.comment AND a.votes=b.votes
          AND a.report=b.report AND a.post_tag=b.post_tag AND a.emb=b.emb
     FROM counts b, counts a WHERE b.stage='baseline' AND a.stage='after delete'),
  'every child row created for the test post is gone, nothing else changed');
SELECT pg_temp.chk('D cascade', 'The shared tag row itself survives (only its link is removed)',
  (SELECT a.tag = b.tag + 1 FROM counts b, counts a WHERE b.stage='baseline' AND a.stage='after delete'),
  'tag kept for other posts');
SELECT pg_temp.chk('D cascade', 'No users were deleted by the cascade',
  (SELECT a.users = b.users FROM counts b, counts a WHERE b.stage='baseline' AND a.stage='after delete'),
  'user count unchanged');

-- =====================================================================
-- E. DELETE RULES FOR USERS, SUBJECTS AND TOPICS
-- =====================================================================
INSERT INTO users (user_id, email, password_hash, role) VALUES ('TESTSTU01','teststu01@campus.edu','x','student');
INSERT INTO student (user_id, anonymous_handle) VALUES ('TESTSTU01','TestHandle01');
INSERT INTO answer (answer_id, post_id, user_id, body) VALUES
 ('f1000000-0000-0000-0000-0000000000b1','f0000000-0000-0000-0000-000000000002','TESTSTU01','from test student');

SELECT pg_temp.expect_error('E delete rules', 'Deleting a user who answered someone else''s post is blocked',
  $$DELETE FROM users WHERE user_id = 'TESTSTU01'$$, '23503');
UPDATE results SET outcome='NOTE', detail = detail || '  -> users are protected from deletion once they have content; plan to deactivate, not delete.'
 WHERE test LIKE 'Deleting a user who answered%' AND outcome='PASS';

SELECT pg_temp.expect_error('E delete rules', 'Deleting a subject that still has posts is blocked',
  $$DELETE FROM subject WHERE subject_id = 'SUB001'$$, '23503');
SELECT pg_temp.expect_error('E delete rules', 'Deleting a topic that posts still use is blocked',
  $$DELETE FROM topic WHERE subject_id = 'SUB001' AND topic_name = 'Normalization'$$, '23503');

-- =====================================================================
-- F. KNOWN INTEGRITY GAP: comment.post_id can disagree with the answer's post
-- =====================================================================
-- answer ...b1 belongs to post 2; try to attach a comment that claims it belongs to a DIFFERENT post
INSERT INTO post (post_id, user_id, subject_id, topic_name, title, body) VALUES
 ('f0000000-0000-0000-0000-0000000000c1','PES1UG24AM001','SUB001','Indexing','TEST other post','body');
SELECT pg_temp.expect_error('F integrity', 'A comment whose post_id does not match its answer''s post is rejected',
  $$INSERT INTO comment (post_id, answer_id, user_id, body)
    VALUES ('f0000000-0000-0000-0000-0000000000c1','f1000000-0000-0000-0000-0000000000b1','PES1UG24CS002','mismatch')$$,
  '23503');
UPDATE results SET outcome='GAP',
  detail='the database ACCEPTED a comment on answer X claiming post Y. Fix: UNIQUE (answer_id, post_id) on answer + FOREIGN KEY (answer_id, post_id) on comment (or drop comment.post_id).'
 WHERE test LIKE 'A comment whose post_id%' AND outcome='FAIL';

-- =====================================================================
-- RESULTS
-- =====================================================================
\o
\set QUIET off
SELECT n, section, test, outcome, detail FROM results ORDER BY n;
SELECT outcome, count(*) FROM results GROUP BY outcome ORDER BY outcome;

ROLLBACK;   -- nothing above is kept
\echo 'All test data rolled back. Your database is unchanged.'