-- ============================================================================
-- Troika app updates — CONSOLIDATED, IDEMPOTENT migration.
--
-- All schema changes made after the original 00001–00019 base migrations live
-- here in ONE file. It is safe to run (and re-run) top to bottom: every
-- statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- When new schema changes are needed, ADD them to the bottom of this file
-- (keep them idempotent) rather than creating new migration files.
-- ============================================================================


-- ── 1. Enrolment discount engine ───────────────────────────────────────────
-- Primary discount (none/plan/legacy/special) + multi-lesson toggle that
-- stacks. discount_value holds the flat ₹ amount when primary = 'special'.
-- (discount_kind is legacy/unused but kept so old references don't break.)
ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS discount_kind TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_kind IN ('percent', 'amount')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (discount_value >= 0),
  ADD COLUMN IF NOT EXISTS discount_primary TEXT NOT NULL DEFAULT 'none'
    CHECK (discount_primary IN ('none', 'plan', 'legacy', 'special')),
  ADD COLUMN IF NOT EXISTS discount_multilesson BOOLEAN NOT NULL DEFAULT false;


-- ── 2. Miscellaneous charges (recital tickets, books, exams, …) ─────────────
-- Payable add-ons stored in payment_records: non-null label + null plan.
ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE payment_records
  ALTER COLUMN plan DROP NOT NULL;


-- ── 3. lessons_used: drift-free recompute (replaces increment trigger) ──────
CREATE OR REPLACE FUNCTION fn_recompute_lessons_used(p_student_id UUID, p_acad_year TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE student_enrolments se
  SET lessons_used = (
        SELECT COUNT(*)
        FROM lesson_students lst
        JOIN lessons l ON l.id = lst.lesson_id
        WHERE lst.student_id = p_student_id
          AND l.status = 'completed'
          AND COALESCE(l.is_charged, true) = true
          AND (l.makeup_direction IS DISTINCT FROM 'teacher_learning')
          AND (lst.attended = true OR lst.absence_category = 'charged')
          AND EXTRACT(YEAR FROM l.date)::TEXT = p_acad_year
      ),
      updated_at = now()
  WHERE se.student_id = p_student_id
    AND se.academic_year = p_acad_year;
END;
$$;

CREATE OR REPLACE FUNCTION fn_lessons_recompute_used()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ls RECORD;
  yr_new TEXT := EXTRACT(YEAR FROM NEW.date)::TEXT;
  yr_old TEXT := EXTRACT(YEAR FROM OLD.date)::TEXT;
BEGIN
  FOR ls IN SELECT DISTINCT student_id FROM lesson_students WHERE lesson_id = NEW.id LOOP
    PERFORM fn_recompute_lessons_used(ls.student_id, yr_new);
    IF yr_old IS DISTINCT FROM yr_new THEN
      PERFORM fn_recompute_lessons_used(ls.student_id, yr_old);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_lesson_students_recompute_used()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_student UUID := COALESCE(NEW.student_id, OLD.student_id);
  v_lesson UUID := COALESCE(NEW.lesson_id, OLD.lesson_id);
  yr TEXT;
BEGIN
  SELECT EXTRACT(YEAR FROM date)::TEXT INTO yr FROM lessons WHERE id = v_lesson;
  IF yr IS NOT NULL THEN
    PERFORM fn_recompute_lessons_used(v_student, yr);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_increment_lessons_used ON lessons;

DROP TRIGGER IF EXISTS trg_lessons_recompute_used ON lessons;
CREATE TRIGGER trg_lessons_recompute_used
  AFTER UPDATE ON lessons
  FOR EACH ROW
  WHEN (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.is_charged IS DISTINCT FROM NEW.is_charged
    OR OLD.makeup_direction IS DISTINCT FROM NEW.makeup_direction
    OR OLD.date IS DISTINCT FROM NEW.date
  )
  EXECUTE FUNCTION fn_lessons_recompute_used();

DROP TRIGGER IF EXISTS trg_lesson_students_recompute_used ON lesson_students;
CREATE TRIGGER trg_lesson_students_recompute_used
  AFTER INSERT OR UPDATE OR DELETE ON lesson_students
  FOR EACH ROW
  EXECUTE FUNCTION fn_lesson_students_recompute_used();

-- Reconcile existing counters (safe to re-run).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT student_id, academic_year FROM student_enrolments LOOP
    PERFORM fn_recompute_lessons_used(r.student_id, r.academic_year);
  END LOOP;
END $$;


-- ── 4. Seed teaching locations ──────────────────────────────────────────────
INSERT INTO locations (name, address, city, zone)
SELECT v.name, '', '', ''
FROM (VALUES ('Links'), ('Edvin'), ('Student''s Home')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.name = v.name);


-- ── 5. Students can download their own invoice file ─────────────────────────
DROP POLICY IF EXISTS "Students read own invoice files" ON storage.objects;
CREATE POLICY "Students read own invoice files" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoices'
    AND EXISTS (
      SELECT 1
      FROM invoices i
      JOIN students s ON s.id = i.student_id
      WHERE i.pdf_path = storage.objects.name
        AND s.user_id = auth.uid()
    )
  );


-- ── 6. Tag each enrolment with its instrument/class ─────────────────────────
-- A student can enrol in several classes (Guitar, Violin, Voice…). Each is its
-- own enrolment; this column records which instrument it is for so the classes
-- are distinguishable in the UI.
ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL;
