-- seed.sql: sample data for Incognito Campus
-- Run AFTER schema.sql. Loads in one transaction, so a failure leaves the tables empty.
--
-- IDs:  users = login IDs (ADMIN001, FAC001.., PES1UG24AM001..)
--       subjects = SUB001..   other tables = readable fixed UUIDs
--       (30.. tag, 40.. post, 50.. answer, 60.. comment, 70.. vote, 80.. report)
-- All password hashes are dummy values, not real logins.

BEGIN;

-- =========================================================
-- 1. USERS (1 admin, 4 teachers, 6 students)
-- =========================================================
INSERT INTO users (user_id, email, password_hash, role, department, created_at) VALUES
('ADMIN001',      'admin@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'admin',   'Administration',   '2026-07-01 09:00'),
('FAC001',        'anita.rao@campus.edu',      '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'teacher', 'Computer Science', '2026-07-01 09:10'),
('FAC002',        'suresh.kumar@campus.edu',   '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'teacher', 'Computer Science', '2026-07-01 09:15'),
('FAC003',        'meera.iyer@campus.edu',     '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'teacher', 'AIML',             '2026-07-01 09:20'),
('FAC004',        'rahul.das@campus.edu',      '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'teacher', 'Mathematics',      '2026-07-01 09:25'),
('PES1UG24AM001', 'am001@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'AIML',             '2026-08-01 10:00'),
('PES1UG24AM002', 'am002@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'AIML',             '2026-08-01 10:05'),
('PES1UG24AM003', 'am003@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'AIML',             '2026-08-01 10:10'),
('PES1UG24CS001', 'cs001@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'Computer Science', '2026-08-01 10:15'),
('PES1UG24CS002', 'cs002@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'Computer Science', '2026-08-01 10:20'),
('PES1UG24CS003', 'cs003@campus.edu',          '$2b$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhash', 'student', 'Computer Science', '2026-08-01 10:25');

-- =========================================================
-- 2. STUDENT (anonymous identities) and 3. TEACHER (verified identities)
-- =========================================================
INSERT INTO student (user_id, anonymous_handle) VALUES
('PES1UG24AM001', 'CuriousOwl'),
('PES1UG24AM002', 'SilentFalcon'),
('PES1UG24AM003', 'BrightLynx'),
('PES1UG24CS001', 'NightCoder'),
('PES1UG24CS002', 'QuickFox'),
('PES1UG24CS003', 'CalmPanda');

INSERT INTO teacher (user_id, display_name, is_verified) VALUES
('FAC001', 'Dr. Anita Rao',     TRUE),
('FAC002', 'Prof. Suresh Kumar', TRUE),
('FAC003', 'Dr. Meera Iyer',    TRUE),
('FAC004', 'Prof. Rahul Das',   FALSE);

-- =========================================================
-- 4. SUBJECT, 5. TOPIC (weak entity), 6. TEACHES
-- =========================================================
INSERT INTO subject (subject_id, subject_code, subject_name, department) VALUES
('SUB001', 'CS301', 'Database Management Systems', 'Computer Science'),
('SUB002', 'CS302', 'Operating Systems',           'Computer Science'),
('SUB003', 'CS201', 'Data Structures',             'Computer Science'),
('SUB004', 'AI301', 'Machine Learning',            'AIML'),
('SUB005', 'MA201', 'Discrete Mathematics',        'Mathematics');

INSERT INTO topic (subject_id, topic_name, description) VALUES
('SUB001', 'Normalization',   '1NF to BCNF, functional dependencies, decomposition'),
('SUB001', 'Indexing',        'B-trees, clustered and non-clustered indexes'),
('SUB001', 'Transactions',    'ACID, isolation levels, concurrency control'),
('SUB001', 'SQL Joins',       'Inner, outer and self joins'),
('SUB002', 'Deadlocks',       'Conditions, detection, prevention, avoidance'),
('SUB002', 'CPU Scheduling',  'FCFS, SJF, round robin, priority'),
('SUB003', 'Trees',           'BST, AVL, heaps'),
('SUB003', 'Graphs',          'Traversals, shortest paths, spanning trees'),
('SUB004', 'Overfitting',     'Bias-variance trade-off, regularisation'),
('SUB005', 'Graph Theory',    'Paths, cycles, colouring, planarity');

INSERT INTO teaches (user_id, subject_id) VALUES
('FAC001', 'SUB001'),
('FAC002', 'SUB002'),
('FAC002', 'SUB003'),
('FAC003', 'SUB004'),
('FAC004', 'SUB005'),
('FAC004', 'SUB003');

-- =========================================================
-- 7. POST (9 doubts; P6 has no topic, P9 is closed as a duplicate)
-- =========================================================
INSERT INTO post (post_id, user_id, subject_id, topic_name, title, body, status, created_at) VALUES
('40000000-0000-0000-0000-000000000001', 'PES1UG24AM001', 'SUB001', 'Normalization',
 'BCNF vs 3NF: when do they actually differ?',
 'Both remove redundancy, but my notes say 3NF can still have anomalies. Can someone give a small example where a relation is in 3NF but not in BCNF?',
 'resolved', '2026-09-02 18:30'),
('40000000-0000-0000-0000-000000000002', 'PES1UG24AM002', 'SUB001', 'Normalization',
 'Is every 3NF relation also in BCNF?',
 'I think the answer is no, but I cannot find a counter example that is not overly complicated.',
 'open', '2026-09-03 11:15'),
('40000000-0000-0000-0000-000000000003', 'PES1UG24CS001', 'SUB001', 'Transactions',
 'Serializable vs repeatable read: what is the real difference?',
 'Both stop dirty and non-repeatable reads. What anomaly does serializable prevent that repeatable read does not?',
 'resolved', '2026-09-05 20:05'),
('40000000-0000-0000-0000-000000000004', 'PES1UG24CS002', 'SUB001', 'Indexing',
 'Clustered vs non-clustered index: which one for range queries?',
 'We have a table of exam results queried mostly by roll number ranges. Should the index on roll number be clustered?',
 'open', '2026-09-08 09:40'),
('40000000-0000-0000-0000-000000000005', 'PES1UG24AM003', 'SUB002', 'Deadlocks',
 'Deadlock vs starvation: how do I tell them apart?',
 'In the exam, how do I decide whether a scenario is a deadlock or starvation? Both seem to leave a process waiting forever.',
 'resolved', '2026-09-10 16:20'),
('40000000-0000-0000-0000-000000000006', 'PES1UG24CS003', 'SUB002', NULL,
 'Which chapters should I prioritise for the OS end-sem?',
 'Only two weeks left. Which units carry the most marks based on previous papers?',
 'open', '2026-09-12 21:00'),
('40000000-0000-0000-0000-000000000007', 'PES1UG24AM001', 'SUB003', 'Trees',
 'Why does AVL deletion sometimes need several rotations but insertion needs at most one?',
 'I can see that insertion needs one rotation, but deletion seems to go up the tree. Why?',
 'resolved', '2026-09-14 12:10'),
('40000000-0000-0000-0000-000000000008', 'PES1UG24CS001', 'SUB004', 'Overfitting',
 'Does dropout reduce overfitting or just hide it?',
 'Validation loss improves with dropout but training loss gets worse. Is the model really generalising better?',
 'open', '2026-09-15 19:45'),
('40000000-0000-0000-0000-000000000009', 'PES1UG24AM002', 'SUB003', 'Graphs',
 'BFS vs DFS for shortest path in an unweighted graph',
 'Which traversal gives the shortest path, and why?',
 'closed', '2026-09-16 08:30');

-- =========================================================
-- 9. TAG and 10. POST_TAG
-- =========================================================
INSERT INTO tag (tag_id, tag_name) VALUES
('30000000-0000-0000-0000-000000000001', 'dbms'),
('30000000-0000-0000-0000-000000000002', 'normalization'),
('30000000-0000-0000-0000-000000000003', 'exam'),
('30000000-0000-0000-0000-000000000004', 'os'),
('30000000-0000-0000-0000-000000000005', 'deadlock'),
('30000000-0000-0000-0000-000000000006', 'indexing'),
('30000000-0000-0000-0000-000000000007', 'transactions'),
('30000000-0000-0000-0000-000000000008', 'trees'),
('30000000-0000-0000-0000-000000000009', 'ml');

INSERT INTO post_tag (post_id, tag_id) VALUES
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002'),
('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003'),
('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'),
('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000007'),
('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001'),
('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000006'),
('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000004'),
('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005'),
('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000004'),
('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000003'),
('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000008'),
('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000009');

-- =========================================================
-- 11. ANSWER (12 answers; P1 has TWO accepted answers)
-- =========================================================
INSERT INTO answer (answer_id, post_id, user_id, body, is_accepted, created_at) VALUES
('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'FAC001',
 'Take R(A,B,C) with A,B -> C and C -> B. Candidate keys are {A,B} and {A,C}, so every attribute is prime and R is in 3NF. But C -> B has a determinant that is not a superkey, so R violates BCNF.',
 TRUE,  '2026-09-02 20:10'),
('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'PES1UG24AM002',
 'Short version: 3NF lets a non-superkey determine a prime attribute, BCNF does not. That is the only gap between them.',
 TRUE,  '2026-09-02 21:00'),
('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'PES1UG24CS002',
 'BCNF is stricter. Some BCNF decompositions lose dependency preservation, which is why 3NF is still used.',
 FALSE, '2026-09-03 08:15'),
('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 'PES1UG24CS001',
 'No. Student(roll, subject, teacher) with teacher -> subject is the textbook example.',
 FALSE, '2026-09-03 13:30'),
('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000003', 'FAC001',
 'Repeatable read still allows phantom rows in the standard definition, because new rows matching a predicate can appear. Serializable also prevents phantoms and write skew.',
 TRUE,  '2026-09-05 22:00'),
('50000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000004', 'PES1UG24AM001',
 'Clustered, since the rows are stored in key order and a range scan reads neighbouring pages.',
 FALSE, '2026-09-08 12:00'),
('50000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000004', 'FAC001',
 'Clustered helps range scans, but a table can only have one. Check whether another query pattern needs it more before you decide.',
 FALSE, '2026-09-08 15:25'),
('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000005', 'FAC002',
 'In a deadlock the waiting processes form a cycle, so none can ever proceed. In starvation the system keeps making progress but one process is repeatedly passed over. Check for a cycle first.',
 TRUE,  '2026-09-10 18:00'),
('50000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000005', 'PES1UG24CS003',
 'Deadlock needs all four Coffman conditions. Starvation needs none of them, just an unfair scheduler.',
 FALSE, '2026-09-10 19:30'),
('50000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000007', 'FAC002',
 'Deleting a node can shorten a subtree, which may unbalance an ancestor, and fixing that can shorten the subtree again, so rotations can propagate to the root. Insertion restores the height after one rotation.',
 TRUE,  '2026-09-14 14:00'),
('50000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000008', 'FAC003',
 'Worse training loss with better validation loss is what regularisation should look like. Compare the gap between the two curves, not the training loss alone.',
 FALSE, '2026-09-16 10:00'),
('50000000-0000-0000-0000-000000000012', '40000000-0000-0000-0000-000000000009', 'PES1UG24CS003',
 'BFS, because it explores nodes in increasing distance from the source.',
 FALSE, '2026-09-16 09:10');

-- =========================================================
-- 12. COMMENT (post_id always matches the answer's post)
-- =========================================================
INSERT INTO comment (comment_id, post_id, answer_id, user_id, body, created_at) VALUES
('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'PES1UG24AM001', 'Thank you, the example with the candidate keys made it click.', '2026-09-02 20:30'),
('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'PES1UG24CS001', 'Good one-line summary for revision.', '2026-09-02 21:20'),
('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004', 'PES1UG24AM002', 'Which dependency makes that fail BCNF?', '2026-09-03 14:00'),
('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000007', 'PES1UG24CS002', 'We also filter by department a lot, so I will test both options.', '2026-09-08 16:00'),
('60000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000009', 'PES1UG24AM003', 'The Coffman conditions part is useful.', '2026-09-10 20:00'),
('60000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000011', 'PES1UG24CS001', 'So I should plot both curves together. Will try that.', '2026-09-16 11:30');

-- =========================================================
-- 13. VOTES (9 on posts, 9 on answers; one downvote each)
-- =========================================================
INSERT INTO votes (vote_id, user_id, post_id, answer_id, vote_value, created_at) VALUES
('70000000-0000-0000-0000-000000000001', 'PES1UG24AM002', '40000000-0000-0000-0000-000000000001', NULL, 1,  '2026-09-02 19:00'),
('70000000-0000-0000-0000-000000000002', 'PES1UG24CS001', '40000000-0000-0000-0000-000000000001', NULL, 1,  '2026-09-02 19:10'),
('70000000-0000-0000-0000-000000000003', 'PES1UG24CS002', '40000000-0000-0000-0000-000000000001', NULL, 1,  '2026-09-02 19:20'),
('70000000-0000-0000-0000-000000000004', 'PES1UG24AM001', '40000000-0000-0000-0000-000000000002', NULL, 1,  '2026-09-03 12:00'),
('70000000-0000-0000-0000-000000000005', 'PES1UG24CS003', '40000000-0000-0000-0000-000000000003', NULL, 1,  '2026-09-05 21:00'),
('70000000-0000-0000-0000-000000000006', 'PES1UG24AM002', '40000000-0000-0000-0000-000000000003', NULL, 1,  '2026-09-05 21:30'),
('70000000-0000-0000-0000-000000000007', 'PES1UG24AM003', '40000000-0000-0000-0000-000000000004', NULL, 1,  '2026-09-08 10:30'),
('70000000-0000-0000-0000-000000000008', 'PES1UG24CS001', '40000000-0000-0000-0000-000000000005', NULL, 1,  '2026-09-10 17:00'),
('70000000-0000-0000-0000-000000000009', 'PES1UG24AM001', '40000000-0000-0000-0000-000000000009', NULL, -1, '2026-09-16 09:00'),
('70000000-0000-0000-0000-000000000010', 'PES1UG24AM001', NULL, '50000000-0000-0000-0000-000000000001', 1,  '2026-09-02 20:40'),
('70000000-0000-0000-0000-000000000011', 'PES1UG24AM002', NULL, '50000000-0000-0000-0000-000000000001', 1,  '2026-09-02 20:50'),
('70000000-0000-0000-0000-000000000012', 'PES1UG24CS001', NULL, '50000000-0000-0000-0000-000000000001', 1,  '2026-09-02 21:05'),
('70000000-0000-0000-0000-000000000013', 'PES1UG24AM001', NULL, '50000000-0000-0000-0000-000000000002', 1,  '2026-09-02 21:30'),
('70000000-0000-0000-0000-000000000014', 'PES1UG24CS002', NULL, '50000000-0000-0000-0000-000000000004', -1, '2026-09-03 14:30'),
('70000000-0000-0000-0000-000000000015', 'PES1UG24AM002', NULL, '50000000-0000-0000-0000-000000000005', 1,  '2026-09-06 08:00'),
('70000000-0000-0000-0000-000000000016', 'PES1UG24CS001', NULL, '50000000-0000-0000-0000-000000000005', 1,  '2026-09-06 09:00'),
('70000000-0000-0000-0000-000000000017', 'PES1UG24AM001', NULL, '50000000-0000-0000-0000-000000000008', 1,  '2026-09-10 18:30'),
('70000000-0000-0000-0000-000000000018', 'PES1UG24CS002', NULL, '50000000-0000-0000-0000-000000000010', 1,  '2026-09-14 15:00');

-- =========================================================
-- 14. REPORT (one pending, one actioned, one dismissed)
-- =========================================================
INSERT INTO report (report_id, reporter_user_id, reviewer_user_id, post_id, answer_id, reason, status, created_at) VALUES
('80000000-0000-0000-0000-000000000001', 'PES1UG24CS002', NULL,       NULL, '50000000-0000-0000-0000-000000000004', 'The example given does not match the definition of 3NF.', 'pending',   '2026-09-04 10:00'),
('80000000-0000-0000-0000-000000000002', 'PES1UG24AM003', 'ADMIN001', '40000000-0000-0000-0000-000000000009', NULL,  'Duplicate of an existing doubt on graph traversals.',      'actioned',  '2026-09-16 12:00'),
('80000000-0000-0000-0000-000000000003', 'PES1UG24CS003', 'ADMIN001', '40000000-0000-0000-0000-000000000006', NULL,  'Not a subject doubt.',                                         'dismissed', '2026-09-13 09:00');

-- =========================================================
-- 8. POST_EMBEDDINGS (optional, needs pgvector)
-- Placeholder vectors so the semantic-search index has data. A real app would
-- compute these with the embedding model. Post 6 has no embedding row yet.
-- If pgvector is not installed, delete this block, the vector column and the
-- hnsw index in schema.sql.
-- =========================================================
INSERT INTO post_embeddings (post_id, embedding, embedding_model, embedding_updated_at)
SELECT v.pid,
       (SELECT array_agg(sin(g * v.k)::real ORDER BY g) FROM generate_series(1, 384) AS g)::vector(384),
       'all-MiniLM-L6-v2',
       v.ts
FROM (VALUES
    ('40000000-0000-0000-0000-000000000001'::uuid, 1, '2026-09-02 18:31'::timestamp),
    ('40000000-0000-0000-0000-000000000002'::uuid, 2, '2026-09-03 11:16'::timestamp),
    ('40000000-0000-0000-0000-000000000003'::uuid, 3, '2026-09-05 20:06'::timestamp),
    ('40000000-0000-0000-0000-000000000004'::uuid, 4, '2026-09-08 09:41'::timestamp),
    ('40000000-0000-0000-0000-000000000005'::uuid, 5, '2026-09-10 16:21'::timestamp),
    ('40000000-0000-0000-0000-000000000007'::uuid, 7, '2026-09-14 12:11'::timestamp),
    ('40000000-0000-0000-0000-000000000008'::uuid, 8, '2026-09-15 19:46'::timestamp),
    ('40000000-0000-0000-0000-000000000009'::uuid, 9, '2026-09-16 08:31'::timestamp)
) AS v(pid, k, ts);

COMMIT;

-- Quick check after loading:
-- SELECT 'users', count(*) FROM users UNION ALL SELECT 'post', count(*) FROM post
-- UNION ALL SELECT 'answer', count(*) FROM answer UNION ALL SELECT 'votes', count(*) FROM votes;