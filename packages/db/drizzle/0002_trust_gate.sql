-- M2 trust layer: the approved-before-publish gate enforced IN the database.
-- No code path — ORM, raw SQL, psql session — can move a delta to published
-- unless it is gate-verified, every citation carries a verifiedAt stamp, and
-- the latest review record is 'approved' (invariants 2, 3, 4). Provenance
-- tables are append-only (invariant 7) and the audit trail cannot be edited.

CREATE FUNCTION enforce_publish_gate() RETURNS trigger AS $$
DECLARE
  latest_review_status review_status;
BEGIN
  IF NEW.published_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.published_at IS NULL) THEN
    IF NEW.verification_status <> 'verified' THEN
      RAISE EXCEPTION 'publish blocked: delta % has verification_status ''%'', not ''verified''',
        NEW.id, NEW.verification_status
        USING ERRCODE = 'check_violation';
    END IF;
    IF jsonb_typeof(NEW.citations) <> 'array' OR jsonb_array_length(NEW.citations) = 0 THEN
      RAISE EXCEPTION 'publish blocked: delta % carries no citations', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.citations) AS c
      WHERE c->>'verifiedAt' IS NULL
    ) THEN
      RAISE EXCEPTION 'publish blocked: delta % has citations without verifiedAt stamps', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT r.status INTO latest_review_status
      FROM review_records r
      WHERE r.delta_id = NEW.id
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1;
    IF latest_review_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'publish blocked: delta % latest review is ''%'', not ''approved''',
        NEW.id, COALESCE(latest_review_status::text, 'absent')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION enforce_published_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.body_md IS DISTINCT FROM OLD.body_md
       OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
       OR NEW.citations IS DISTINCT FROM OLD.citations
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      RAISE EXCEPTION 'published delta % is immutable — corrections ship as a new delta', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION forbid_row_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % refused', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deltas_publish_gate
BEFORE INSERT OR UPDATE ON deltas
FOR EACH ROW EXECUTE FUNCTION enforce_publish_gate();
--> statement-breakpoint
CREATE TRIGGER deltas_published_immutable
BEFORE UPDATE ON deltas
FOR EACH ROW EXECUTE FUNCTION enforce_published_immutable();
--> statement-breakpoint
CREATE TRIGGER section_versions_append_only
BEFORE UPDATE OR DELETE ON section_versions
FOR EACH ROW EXECUTE FUNCTION forbid_row_change();
--> statement-breakpoint
CREATE TRIGGER review_records_append_only
BEFORE UPDATE OR DELETE ON review_records
FOR EACH ROW EXECUTE FUNCTION forbid_row_change();
