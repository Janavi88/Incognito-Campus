-- test_merge_moderation.sql: edge-case tests for 002. Run on a freshly loaded DB (schema, seed, 001, 002);
-- it changes data, so reload everything before running it again. Expected: ERROR lines where marked.
\set ON_ERROR_STOP off
\echo '--- 1. student tries to merge (expect: only admin/verified teacher)'
SELECT merge_post('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','PES1UG24AM001');
\echo '--- 2. UNVERIFIED teacher FAC004 tries to merge (expect error)'
SELECT merge_post('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','FAC004');
\echo '--- 3. self merge (expect error)'
SELECT merge_post('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','ADMIN001');
\echo '--- 4. valid merge: post 2 -> post 1 by FAC001'
SELECT merge_post('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','FAC001');
SELECT post_id::text, status, merged_into::text FROM post WHERE post_id IN ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002') ORDER BY 1;
\echo '--- 5. merge again (expect already merged)'
SELECT merge_post('40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','FAC001');
\echo '--- 6. merge INTO a merged post (expect error pointing to post 1)'
SELECT merge_post('40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000002','FAC001');
\echo '--- 7. merge post that already has duplicates into another (expect error)'
SELECT merge_post('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','FAC001');
\echo '--- 8. thread view for post 1: answers from the merged duplicate appear'
SELECT left(answer_id::text,8) a, left(written_on_post_id::text,8)||'..'||right(written_on_post_id::text,1) wrote_on, from_merged_duplicate FROM v_thread_answers WHERE thread_post_id='40000000-0000-0000-0000-000000000001' ORDER BY created_at;
\echo '--- 10. self-report (expect error)'
INSERT INTO report (reporter_user_id, post_id, reason) VALUES ('PES1UG24AM001','40000000-0000-0000-0000-000000000001','x');
\echo '--- 11. duplicate report by same user (expect unique violation)'
INSERT INTO report (reporter_user_id, answer_id, reason) VALUES ('PES1UG24CS002','50000000-0000-0000-0000-000000000004','again');
\echo '--- 12. valid new report'
INSERT INTO report (reporter_user_id, answer_id, reason) VALUES ('PES1UG24AM003','50000000-0000-0000-0000-000000000004','wrong example');
\echo '--- 13. student reviews (expect error)'
SELECT review_report('80000000-0000-0000-0000-000000000001','PES1UG24AM001','dismissed');
\echo '--- 14. reviewer is the answer author CS001 -- not a mod, expect error; use FAC001 as author case below'
SELECT review_report('80000000-0000-0000-0000-000000000001','PES1UG24CS001','dismissed');
\echo '--- 15. FAC001 reviewing report on THEIR OWN answer (expect conflict error)'
INSERT INTO report (reporter_user_id, answer_id, reason) VALUES ('PES1UG24CS003','50000000-0000-0000-0000-000000000005','unclear');
SELECT review_report(report_id,'FAC001','dismissed') FROM report WHERE answer_id='50000000-0000-0000-0000-000000000005';
\echo '--- 16. admin dismisses report #1 (ok), then tries again (expect already)'
SELECT review_report('80000000-0000-0000-0000-000000000001','ADMIN001','dismissed');
SELECT review_report('80000000-0000-0000-0000-000000000001','ADMIN001','actioned');
\echo '--- 17. direct UPDATE reopening a decided report (expect blocked)'
UPDATE report SET status='pending', reviewer_user_id=NULL WHERE report_id='80000000-0000-0000-0000-000000000001';
\echo '--- 18. bad decision value'
SELECT review_report('80000000-0000-0000-0000-000000000001','ADMIN001','banana');
\echo '--- 19. pending report on a duplicate gets actioned by merge'
INSERT INTO report (reporter_user_id, post_id, reason) VALUES ('PES1UG24AM003','40000000-0000-0000-0000-000000000004','dup');
SELECT merge_post('40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000003','ADMIN001');
SELECT status, reviewer_user_id FROM report WHERE post_id='40000000-0000-0000-0000-000000000004';
\echo '--- 20. final state of all reports'
SELECT left(report_id::text,8) r, reporter_user_id, status, reviewer_user_id FROM report ORDER BY created_at;