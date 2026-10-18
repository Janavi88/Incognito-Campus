-- 002_merge_and_moderation.sql  (Janavi: merge workflow + moderation rules)
-- Run AFTER schema.sql, seed.sql and 001_search_moderation.sql.
BEGIN;

-- ---------------------------------------------------------------------
-- 0. Data fix: seed report #3 has CS003 reporting their OWN post (post 6).
--    That breaks the "no self-reports" rule below. Change the reporter.
--    (Also change this row in seed.sql so a fresh load is clean.)
-- ---------------------------------------------------------------------
UPDATE report
   SET reporter_user_id = 'PES1UG24AM001'
 WHERE report_id = '80000000-0000-0000-0000-000000000003'
   AND reporter_user_id = 'PES1UG24CS003';

-- ---------------------------------------------------------------------
-- 1. Helper: can this user moderate?  (admin, or a VERIFIED teacher)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_moderator(p_user_id VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1
          FROM users u
          LEFT JOIN teacher t ON t.user_id = u.user_id
         WHERE u.user_id = p_user_id
           AND (u.role = 'admin' OR (u.role = 'teacher' AND t.is_verified))
    );
$$;

-- ---------------------------------------------------------------------
-- 2. Report rules (trigger)
--    - no reporting your own post / answer
--    - reviewer must be a moderator, not the reporter, not the content's author
--    - a decided report (actioned/dismissed) can't be changed again
--    - who/what was reported can't be edited after filing
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_report_rules()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_author VARCHAR(20);
BEGIN
    -- author of the reported content
    IF NEW.post_id IS NOT NULL THEN
        SELECT user_id INTO v_author FROM post   WHERE post_id   = NEW.post_id;
    ELSE
        SELECT user_id INTO v_author FROM answer WHERE answer_id = NEW.answer_id;
    END IF;

    IF NEW.reporter_user_id = v_author THEN
        RAISE EXCEPTION 'You cannot report your own content'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.reporter_user_id IS DISTINCT FROM OLD.reporter_user_id
           OR NEW.post_id       IS DISTINCT FROM OLD.post_id
           OR NEW.answer_id     IS DISTINCT FROM OLD.answer_id THEN
            RAISE EXCEPTION 'The reporter and the reported content cannot be changed'
                USING ERRCODE = 'check_violation';
        END IF;

        IF OLD.status <> 'pending'
           AND (NEW.status <> OLD.status
                OR NEW.reviewer_user_id IS DISTINCT FROM OLD.reviewer_user_id) THEN
            RAISE EXCEPTION 'Report % is already %, it cannot be reviewed again',
                OLD.report_id, OLD.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF NEW.reviewer_user_id IS NOT NULL THEN
        IF NOT is_moderator(NEW.reviewer_user_id) THEN
            RAISE EXCEPTION 'Only an admin or a verified teacher can review reports'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.reviewer_user_id = NEW.reporter_user_id THEN
            RAISE EXCEPTION 'A reviewer cannot review their own report'
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.reviewer_user_id = v_author THEN
            RAISE EXCEPTION 'A reviewer cannot review a report about their own content'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS report_rules ON report;
CREATE TRIGGER report_rules
    BEFORE INSERT OR UPDATE ON report
    FOR EACH ROW EXECUTE FUNCTION trg_report_rules();

-- ---------------------------------------------------------------------
-- 3. review_report(): the moderator's action on one report
--    p_decision is 'actioned' or 'dismissed'. Row is locked while deciding,
--    so two moderators can't both decide the same report.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION review_report(
    p_report_id UUID,
    p_reviewer  VARCHAR,
    p_decision  VARCHAR
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_status VARCHAR(10);
BEGIN
    IF p_decision NOT IN ('actioned', 'dismissed') THEN
        RAISE EXCEPTION 'Decision must be actioned or dismissed, got %', p_decision;
    END IF;

    SELECT status INTO v_status FROM report WHERE report_id = p_report_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report % does not exist', p_report_id;
    END IF;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'Report % is already %', p_report_id, v_status;
    END IF;

    -- the trigger validates the reviewer's role and conflicts of interest
    UPDATE report
       SET status = p_decision,
           reviewer_user_id = p_reviewer
     WHERE report_id = p_report_id;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. merge_post(): mark a duplicate and point it at the original.
--    One function = one transaction: either everything below happens or nothing.
--    Answers STAY on the duplicate (votes/comments keep pointing at them);
--    the view v_thread_answers shows them under the original post.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_post(
    p_duplicate UUID,
    p_original  UUID,
    p_actor     VARCHAR
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    v_dup_merged  UUID;
    v_orig_merged UUID;
BEGIN
    IF NOT is_moderator(p_actor) THEN
        RAISE EXCEPTION 'Only an admin or a verified teacher can merge posts'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF p_duplicate = p_original THEN
        RAISE EXCEPTION 'A post cannot be merged into itself';
    END IF;

    -- lock both rows in a fixed order (avoids deadlock if two merges overlap)
    PERFORM 1 FROM post
      WHERE post_id IN (p_duplicate, p_original)
      ORDER BY post_id
      FOR UPDATE;

    SELECT merged_into INTO v_dup_merged  FROM post WHERE post_id = p_duplicate;
    IF NOT FOUND THEN RAISE EXCEPTION 'Duplicate post % does not exist', p_duplicate; END IF;
    SELECT merged_into INTO v_orig_merged FROM post WHERE post_id = p_original;
    IF NOT FOUND THEN RAISE EXCEPTION 'Original post % does not exist', p_original; END IF;

    IF v_dup_merged IS NOT NULL THEN
        RAISE EXCEPTION 'Post % is already merged into %', p_duplicate, v_dup_merged;
    END IF;
    IF v_orig_merged IS NOT NULL THEN
        RAISE EXCEPTION 'Original post % is itself a merged duplicate; merge into % instead',
            p_original, v_orig_merged;
    END IF;
    IF EXISTS (SELECT 1 FROM post WHERE merged_into = p_duplicate) THEN
        RAISE EXCEPTION 'Post % already has duplicates merged into it; merge those into % first',
            p_duplicate, p_original;
    END IF;

    UPDATE post
       SET status = 'closed', merged_into = p_original
     WHERE post_id = p_duplicate;

    -- reports filed against the duplicate are now dealt with
    UPDATE report
       SET status = 'actioned', reviewer_user_id = p_actor
     WHERE post_id = p_duplicate AND status = 'pending';
END;
$$;

-- ---------------------------------------------------------------------
-- 5. v_thread_answers: all answers for a thread, including answers that were
--    written on posts later merged into it. (No user_id here on purpose:
--    the app layer decides how to show author identity.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_thread_answers AS
SELECT COALESCE(p.merged_into, p.post_id) AS thread_post_id,
       a.answer_id,
       a.post_id       AS written_on_post_id,
       a.body,
       a.is_accepted,
       a.created_at,
       (p.merged_into IS NOT NULL) AS from_merged_duplicate
  FROM answer a
  JOIN post p ON p.post_id = a.post_id;

COMMIT;