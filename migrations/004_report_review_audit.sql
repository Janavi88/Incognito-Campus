-- Record when a report is reviewed so the moderation history can show who decided and when.
ALTER TABLE report
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

CREATE OR REPLACE FUNCTION stamp_report_reviewed_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'pending'
       AND NEW.status IN ('actioned', 'dismissed')
       AND NEW.reviewer_user_id IS NOT NULL THEN
        NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_review_timestamp ON report;
CREATE TRIGGER trg_report_review_timestamp
BEFORE UPDATE OF status, reviewer_user_id ON report
FOR EACH ROW
EXECUTE FUNCTION stamp_report_reviewed_at();
