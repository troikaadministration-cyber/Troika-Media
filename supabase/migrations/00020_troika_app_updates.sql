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


-- ── 7. Server-side aggregates for Dashboard and Reports ───────────────────
--
-- Previously both pages downloaded entire tables (every payment record, every
-- lesson_students row) and summed them in the browser. That was slow, and once
-- a table passed the API row cap (1000 rows by default on Supabase) the totals
-- silently became wrong. These functions return only the numbers the pages show.
--
-- Both are coordinator-only. `p_today` is passed by the client so "today" and
-- "this month" follow the school's local timezone (IST), not the server's UTC.

CREATE OR REPLACE FUNCTION public.dashboard_summary(p_today date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', p_today)::date;
  v_result jsonb;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can view the dashboard summary' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'active_students', (SELECT count(*) FROM students WHERE is_active),
    'total_students',  (SELECT count(*) FROM students),
    'collected_month', (SELECT COALESCE(sum(amount), 0) FROM payment_records
                         WHERE paid_date IS NOT NULL AND paid_date >= v_month_start AND paid_date <= p_today),
    -- Due now (today or earlier); future instalments are reported separately.
    'outstanding',     (SELECT COALESCE(sum(amount), 0) FROM payment_records WHERE paid_date IS NULL AND due_date <= p_today),
    'upcoming',        (SELECT COALESCE(sum(amount), 0) FROM payment_records WHERE paid_date IS NULL AND due_date > p_today),
    'overdue_count',   (SELECT count(*) FROM payment_records WHERE paid_date IS NULL AND due_date < p_today),
    'week_series',     (SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY d.day)
                          FROM generate_series(p_today - 6, p_today, interval '1 day') AS d(day)
                          LEFT JOIN (
                            SELECT date, count(*) AS n FROM lessons
                            WHERE date BETWEEN p_today - 6 AND p_today AND status <> 'cancelled'
                            GROUP BY date
                          ) c ON c.date = d.day::date),
    'top_dues',        (SELECT COALESCE(jsonb_agg(t ORDER BY t.due_date), '[]'::jsonb) FROM (
                          SELECT pr.amount, pr.due_date, pr.label,
                                 jsonb_build_object('id', s.id, 'full_name', s.full_name) AS student
                          FROM payment_records pr
                          LEFT JOIN students s ON s.id = pr.student_id
                          WHERE pr.paid_date IS NULL AND pr.due_date <= p_today + 7
                          ORDER BY pr.due_date
                          LIMIT 4
                        ) t)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_summary(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(date) TO authenticated;


-- One row per student that has any payments, enrolments or attendance.
CREATE OR REPLACE FUNCTION public.reports_summary(p_today date)
RETURNS TABLE (
  student_id uuid,
  full_name text,
  collected numeric,
  outstanding numeric,
  overdue numeric,
  lessons_used bigint,
  lessons_total bigint,
  attended bigint,
  absent bigint,
  charged_absent bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can view reports' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH pay AS (
    SELECT pr.student_id,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NOT NULL), 0) AS collected,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NULL), 0) AS outstanding,
           COALESCE(sum(pr.amount) FILTER (WHERE pr.paid_date IS NULL AND pr.due_date < p_today), 0) AS overdue
    FROM payment_records pr
    GROUP BY pr.student_id
  ),
  enr AS (
    SELECT se.student_id,
           COALESCE(sum(se.lessons_used), 0)::bigint AS lessons_used,
           COALESCE(sum(se.total_lessons), 0)::bigint AS lessons_total
    FROM student_enrolments se
    GROUP BY se.student_id
  ),
  att AS (
    SELECT ls.student_id,
           count(*) FILTER (WHERE ls.attended IS TRUE) AS attended,
           count(*) FILTER (WHERE ls.attended IS FALSE) AS absent,
           count(*) FILTER (WHERE ls.attended IS FALSE AND ls.absence_category = 'charged') AS charged_absent
    FROM lesson_students ls
    JOIN lessons l ON l.id = ls.lesson_id AND l.status = 'completed'  -- reopened/cancelled lessons don't count
    GROUP BY ls.student_id
  ),
  ids AS (
    SELECT p.student_id FROM pay p UNION SELECT e.student_id FROM enr e UNION SELECT a.student_id FROM att a
  )
  SELECT s.id, s.full_name,
         COALESCE(pay.collected, 0), COALESCE(pay.outstanding, 0), COALESCE(pay.overdue, 0),
         COALESCE(enr.lessons_used, 0), COALESCE(enr.lessons_total, 0),
         COALESCE(att.attended, 0), COALESCE(att.absent, 0), COALESCE(att.charged_absent, 0)
  FROM ids
  JOIN students s ON s.id = ids.student_id
  LEFT JOIN pay ON pay.student_id = s.id
  LEFT JOIN enr ON enr.student_id = s.id
  LEFT JOIN att ON att.student_id = s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reports_summary(date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reports_summary(date) TO authenticated;


-- ── 8. Link instalments and lessons to the enrolment they belong to ───────
-- Previously instalments were only tied to (student, plan), so a second class
-- on the same plan generated no instalments at all (never billed), and
-- lessons_used was the combined count across all of a student's classes.
ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS enrolment_id UUID REFERENCES student_enrolments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payment_records_enrolment ON payment_records(enrolment_id);

ALTER TABLE lesson_students
  ADD COLUMN IF NOT EXISTS enrolment_id UUID REFERENCES student_enrolments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_students_enrolment ON lesson_students(enrolment_id);

-- Backfill: only where the match is unambiguous (one enrolment for that student+plan).
UPDATE payment_records pr
SET enrolment_id = se.id
FROM student_enrolments se
WHERE pr.enrolment_id IS NULL
  AND pr.plan IS NOT NULL
  AND se.student_id = pr.student_id
  AND se.payment_plan = pr.plan
  AND (SELECT count(*) FROM student_enrolments x
        WHERE x.student_id = pr.student_id AND x.payment_plan = pr.plan) = 1;


-- ── 9. generate_instalments: per enrolment, exact totals ──────────────────
CREATE OR REPLACE FUNCTION generate_instalments(p_enrolment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  num_instalments INTEGER;
  per_instalment NUMERIC(10,2);
  amount NUMERIC(10,2);
  i INTEGER;
  due DATE;
BEGIN
  SELECT * INTO rec FROM student_enrolments WHERE id = p_enrolment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found: %', p_enrolment_id;
  END IF;

  -- Idempotent per enrolment (not per student+plan).
  IF EXISTS (SELECT 1 FROM payment_records WHERE enrolment_id = p_enrolment_id) THEN
    RETURN;
  END IF;

  CASE rec.payment_plan
    WHEN 'trial' THEN RETURN;
    WHEN '1_instalment' THEN num_instalments := 1;
    WHEN '3_instalments' THEN num_instalments := 3;
    WHEN '10_instalments' THEN num_instalments := 10;
    ELSE RAISE EXCEPTION 'Unknown payment plan: %', rec.payment_plan;
  END CASE;

  IF COALESCE(rec.total_fee, 0) + COALESCE(rec.registration_fee, 0) <= 0 THEN
    RETURN; -- nothing to bill (avoid ₹0 "overdue" rows)
  END IF;

  per_instalment := ROUND(rec.total_fee / num_instalments, 2);

  FOR i IN 1..num_instalments LOOP
    CASE num_instalments
      WHEN 1 THEN due := rec.start_date;
      WHEN 3 THEN due := (rec.start_date + ((i - 1) * 4 * INTERVAL '1 month'))::DATE;
      WHEN 10 THEN due := (rec.start_date + ((i - 1) * INTERVAL '1 month'))::DATE;
    END CASE;

    -- Last instalment absorbs rounding so the instalments add up to total_fee exactly.
    IF i = num_instalments THEN
      amount := rec.total_fee - per_instalment * (num_instalments - 1);
    ELSE
      amount := per_instalment;
    END IF;
    IF i = 1 THEN
      amount := amount + COALESCE(rec.registration_fee, 0);
    END IF;

    INSERT INTO payment_records (student_id, plan, amount, instalment_number, due_date, enrolment_id)
    VALUES (rec.student_id, rec.payment_plan, amount, i, due, p_enrolment_id);
  END LOOP;
END;
$$;


-- ── 10. lessons_used: each lesson counts toward exactly one enrolment ─────
-- A lesson_students row linked to an enrolment counts for that enrolment.
-- Older rows (no link, e.g. made before this change or by makeup scheduling)
-- go to the student's enrolment for that year with the same instrument, or
-- else their earliest enrolment that year — never to several at once.
CREATE OR REPLACE FUNCTION fn_recompute_lessons_used(p_student_id UUID, p_acad_year TEXT)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE student_enrolments se
  SET lessons_used = (
        SELECT COUNT(*)
        FROM lesson_students lst
        JOIN lessons l ON l.id = lst.lesson_id
        WHERE lst.student_id = se.student_id
          AND l.status = 'completed'
          AND COALESCE(l.is_charged, true) = true
          AND (l.makeup_direction IS DISTINCT FROM 'teacher_learning')
          AND (lst.attended = true OR lst.absence_category = 'charged')
          AND (
            lst.enrolment_id = se.id
            OR (
              lst.enrolment_id IS NULL
              AND EXTRACT(YEAR FROM l.date)::TEXT = se.academic_year
              AND se.id = (
                SELECT se2.id FROM student_enrolments se2
                WHERE se2.student_id = lst.student_id
                  AND se2.academic_year = se.academic_year
                ORDER BY (se2.instrument_id IS NOT DISTINCT FROM l.instrument_id) DESC,
                         se2.created_at, se2.id
                LIMIT 1
              )
            )
          )
      ),
      updated_at = now()
  WHERE se.student_id = p_student_id
    AND (p_acad_year IS NULL OR se.academic_year = p_acad_year
         -- linked rows may sit in a different calendar year than the enrolment
         OR EXISTS (SELECT 1 FROM lesson_students x WHERE x.enrolment_id = se.id));
END;
$$;

CREATE OR REPLACE FUNCTION fn_lesson_students_recompute_used()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_student UUID := COALESCE(NEW.student_id, OLD.student_id);
  v_lesson UUID := COALESCE(NEW.lesson_id, OLD.lesson_id);
  yr TEXT;
BEGIN
  SELECT EXTRACT(YEAR FROM date)::TEXT INTO yr FROM lessons WHERE id = v_lesson;
  -- yr is NULL when the lesson itself is being deleted: recount all years.
  PERFORM fn_recompute_lessons_used(v_student, yr);
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Reconcile counters with the new rule (safe to re-run).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT student_id FROM student_enrolments LOOP
    PERFORM fn_recompute_lessons_used(r.student_id, NULL);
  END LOOP;
END $$;


-- ── 11. Invoice numbers: atomic, no duplicates under concurrent clicks ────
-- MAX()+1 let two simultaneous "Mark paid" clicks get the same number. A
-- counter row updated atomically can't. Year follows IST, not UTC.
CREATE TABLE IF NOT EXISTS invoice_counters (
  year TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
);
ALTER TABLE invoice_counters ENABLE ROW LEVEL SECURITY;  -- no policies: only the function below touches it

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  y TEXT := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY');
  n INTEGER;
BEGIN
  INSERT INTO invoice_counters AS c (year, last_number)
  VALUES (
    y,
    COALESCE((SELECT MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER))
              FROM invoices WHERE invoice_number LIKE 'INV-' || y || '-%'), 0) + 1
  )
  ON CONFLICT (year) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || y || '-' || LPAD(n::TEXT, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION next_invoice_number() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_invoice_number() TO service_role;


-- (Columns used below; section 27 documents them.)
ALTER TABLE teacher_schedule_templates ADD COLUMN IF NOT EXISTS counts_toward_lessons BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES teacher_schedule_templates(id) ON DELETE SET NULL;

-- ── 12. enrol_student: the whole enrolment in ONE transaction ─────────────
-- Replaces 6–120 separate browser requests (with hand-written rollback) by a
-- single call. Creates the enrolment, attaches the student to the weekly slot,
-- schedules their lessons and generates their instalments — all or nothing.
--  * Joining an existing slot links the student to that slot's existing
--    lessons instead of skipping those dates (previously: 0 lessons).
--  * A slot must belong to the chosen teacher.
--  * Dates where the teacher already teaches something else are reported as
--    conflicts rather than silently double-booked.
CREATE OR REPLACE FUNCTION public.enrol_student(
  p_student_id UUID,
  p_teacher_id UUID,
  p_payment_plan payment_plan,
  p_start_date DATE,
  p_end_date DATE,
  p_total_lessons INTEGER,
  p_rate_per_lesson NUMERIC,
  p_total_fee NUMERIC,
  p_registration_fee NUMERIC DEFAULT 0,
  p_lesson_rate_id UUID DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL,
  p_discount_primary TEXT DEFAULT 'none',
  p_discount_multilesson BOOLEAN DEFAULT false,
  p_discount_value NUMERIC DEFAULT 0,
  -- slot: either an existing template …
  p_template_id UUID DEFAULT NULL,
  -- … or a new one
  p_day_of_week INTEGER DEFAULT NULL,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_instrument_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl teacher_schedule_templates%ROWTYPE;
  v_enrolment_id UUID;
  v_location UUID;
  v_end_time TIME;
  v_date DATE;
  v_existing RECORD;
  v_lesson_id UUID;
  v_created INTEGER := 0;
  v_joined INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can enrol students' USING ERRCODE = '42501';
  END IF;

  -- ── validation ──
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher') THEN
    RAISE EXCEPTION 'Please choose a teacher';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'End date must be after the start date';
  END IF;
  IF p_total_lessons IS NULL OR p_total_lessons < 1 OR p_total_lessons > 60 THEN
    RAISE EXCEPTION 'Number of lessons must be between 1 and 60';
  END IF;
  IF COALESCE(p_rate_per_lesson, -1) < 0 OR COALESCE(p_total_fee, -1) < 0
     OR COALESCE(p_registration_fee, 0) < 0 OR COALESCE(p_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Fees and discounts cannot be negative';
  END IF;
  IF p_payment_plan <> 'trial' AND p_rate_per_lesson <= 0 THEN
    RAISE EXCEPTION 'Enter a lesson rate greater than ₹0 (or choose the Trial plan)';
  END IF;

  -- ── slot ──
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM teacher_schedule_templates WHERE id = p_template_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That schedule slot no longer exists';
    END IF;
    IF v_tpl.teacher_id <> p_teacher_id THEN
      RAISE EXCEPTION 'That slot belongs to a different teacher — pick a slot for the selected teacher';
    END IF;
    IF NOT (p_student_id = ANY(COALESCE(v_tpl.student_ids, '{}'))) THEN
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = p_template_id;
    END IF;
  ELSE
    IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
      RAISE EXCEPTION 'Choose a day and start time for the new slot';
    END IF;
    IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
      RAISE EXCEPTION 'Slot end time must be after the start time';
    END IF;
    INSERT INTO teacher_schedule_templates
      (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids, is_active)
    VALUES
      (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
       COALESCE(NULLIF(trim(p_title), ''), 'Lesson'), ARRAY[p_student_id], true)
    RETURNING * INTO v_tpl;
  END IF;

  v_location := COALESCE(v_tpl.location_id, p_location_id,
                         (SELECT location_id FROM students WHERE id = p_student_id));
  v_end_time := COALESCE(v_tpl.end_time, v_tpl.start_time + INTERVAL '45 minutes');

  -- ── enrolment ──
  INSERT INTO student_enrolments (
    student_id, academic_year, lesson_rate_id, total_lessons, lessons_used, start_date,
    payment_plan, rate_per_lesson, total_fee, registration_fee, instrument_id,
    discount_primary, discount_multilesson, discount_value
  ) VALUES (
    p_student_id, COALESCE(NULLIF(p_academic_year, ''), to_char(p_start_date, 'YYYY')), p_lesson_rate_id,
    p_total_lessons, 0, p_start_date, p_payment_plan, p_rate_per_lesson, p_total_fee,
    COALESCE(p_registration_fee, 0), COALESCE(v_tpl.instrument_id, p_instrument_id),
    COALESCE(p_discount_primary, 'none'), COALESCE(p_discount_multilesson, false),
    CASE WHEN p_discount_primary = 'special' THEN COALESCE(p_discount_value, 0) ELSE 0 END
  ) RETURNING id INTO v_enrolment_id;

  -- ── lessons: weekly on the slot's day, from start date, until enough ──
  FOR v_date IN
    SELECT d::date FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS d
    WHERE EXTRACT(DOW FROM d) = v_tpl.day_of_week
    ORDER BY d
  LOOP
    EXIT WHEN v_created + v_joined >= p_total_lessons;

    -- Same slot already has a lesson that day (e.g. a group class): join it.
    SELECT l.id, l.instrument_id INTO v_existing
    FROM lessons l
    WHERE l.teacher_id = p_teacher_id AND l.date = v_date AND l.start_time = v_tpl.start_time
      AND l.status <> 'cancelled'
    LIMIT 1;

    IF FOUND THEN
      -- Only join when the coordinator deliberately picked an existing slot;
      -- a NEW slot at an occupied time is a clash (never merge into someone's 1:1).
      IF p_template_id IS NOT NULL AND v_existing.instrument_id IS NOT DISTINCT FROM v_tpl.instrument_id THEN
        INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
        VALUES (v_existing.id, p_student_id, v_enrolment_id)
        ON CONFLICT (lesson_id, student_id) DO UPDATE SET enrolment_id = EXCLUDED.enrolment_id;
        v_joined := v_joined + 1;
      ELSE
        v_conflicts := v_conflicts + 1;
        v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      END IF;
      CONTINUE;
    END IF;

    -- Teacher busy with a different lesson overlapping this time: don't double-book.
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = p_teacher_id AND l.date = v_date AND l.status <> 'cancelled'
        AND l.start_time < v_end_time
        AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > v_tpl.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      CONTINUE;
    END IF;

    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time, title,
                         template_id, is_charged)
    VALUES (p_teacher_id, v_location, v_tpl.instrument_id, 'regular', v_date, v_tpl.start_time, v_tpl.end_time,
            COALESCE(NULLIF(v_tpl.title, ''), 'Lesson'), v_tpl.id, COALESCE(v_tpl.counts_toward_lessons, true))
    RETURNING id INTO v_lesson_id;

    INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
    VALUES (v_lesson_id, p_student_id, v_enrolment_id);
    v_created := v_created + 1;
  END LOOP;

  -- ── instalments ──
  PERFORM generate_instalments(v_enrolment_id);

  RETURN jsonb_build_object(
    'enrolment_id', v_enrolment_id,
    'template_id', v_tpl.id,
    'lessons_created', v_created,
    'lessons_joined', v_joined,
    'lessons_scheduled', v_created + v_joined,
    'lessons_expected', p_total_lessons,
    'conflicts', v_conflicts,
    'conflict_dates', to_jsonb(v_conflict_dates)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID) TO authenticated;


-- ── 13. delete_enrolment: remove an enrolment AND what it created ─────────
-- Deleting only the enrolment row used to leave its unpaid instalments
-- (still shown as overdue) and its future lessons behind. Paid instalments
-- are kept (financial history); they just lose the enrolment link.
CREATE OR REPLACE FUNCTION public.delete_enrolment(p_enrolment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enr student_enrolments%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_unpaid INTEGER;
  v_lessons INTEGER;
  v_lesson_ids UUID[];
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can delete enrolments' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_enr FROM student_enrolments WHERE id = p_enrolment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found';
  END IF;

  DELETE FROM payment_records WHERE enrolment_id = p_enrolment_id AND paid_date IS NULL;
  GET DIAGNOSTICS v_unpaid = ROW_COUNT;

  -- Unlink the student from this enrolment's future, not-yet-held lessons,
  -- then delete those lessons if nobody else is in them.
  WITH removed AS (
    DELETE FROM lesson_students ls
    USING lessons l
    WHERE ls.lesson_id = l.id AND ls.enrolment_id = p_enrolment_id
      AND l.date >= v_today AND l.status = 'scheduled'
    RETURNING ls.lesson_id
  )
  SELECT COALESCE(array_agg(lesson_id), '{}') INTO v_lesson_ids FROM removed;
  v_lessons := COALESCE(array_length(v_lesson_ids, 1), 0);

  DELETE FROM lessons l
  WHERE l.id = ANY(v_lesson_ids)
    AND NOT EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.lesson_id = l.id);

  -- Take the student off weekly slots for this instrument.
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, v_enr.student_id), updated_at = now()
    WHERE v_enr.student_id = ANY(student_ids)
      AND instrument_id IS NOT DISTINCT FROM v_enr.instrument_id
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                       WHERE o.student_id = v_enr.student_id AND o.id <> v_enr.id
                         AND o.instrument_id IS NOT DISTINCT FROM v_enr.instrument_id);

  DELETE FROM student_enrolments WHERE id = p_enrolment_id;

  RETURN jsonb_build_object('unpaid_instalments_removed', v_unpaid, 'future_lessons_removed', v_lessons);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_enrolment(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_enrolment(UUID) TO authenticated;


-- ── 14. Keep financial history when a student is deleted ──────────────────
-- payment_records and invoices used to cascade-delete with the student, wiping
-- revenue from reports. Now a student with payments/invoices can't be deleted
-- (deactivate them instead).
ALTER TABLE payment_records DROP CONSTRAINT IF EXISTS payment_records_student_id_fkey;
ALTER TABLE payment_records
  ADD CONSTRAINT payment_records_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_student_id_fkey;
ALTER TABLE invoices
  ADD CONSTRAINT invoices_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;


-- ── 15. complete_profile_setup: safe self-service role selection ──────────
-- New sign-ups get an auto-created blank 'student' profile. Choosing a role
-- used to be a browser upsert, which (a) failed for teachers because users may
-- not change their own role, and (b) could overwrite an existing profile. This
-- function only allows teacher/student, only on a profile that hasn't been set
-- up yet, and always leaves it pending coordinator approval. Students are also
-- linked to (or get) their students row in the same transaction.
CREATE OR REPLACE FUNCTION public.complete_profile_setup(p_role TEXT, p_full_name TEXT)
RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_profile profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('teacher', 'student') THEN
    RAISE EXCEPTION 'Choose Teacher or Student';
  END IF;
  IF COALESCE(trim(p_full_name), '') = '' OR length(trim(p_full_name)) > 120 THEN
    RAISE EXCEPTION 'Please enter your full name';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  SELECT * INTO v_profile FROM profiles WHERE id = v_uid FOR UPDATE;
  IF FOUND AND (v_profile.role = 'coordinator' OR COALESCE(trim(v_profile.full_name), '') <> ''
                OR v_profile.approved IS NOT NULL) THEN
    RAISE EXCEPTION 'Your account is already set up';
  END IF;

  INSERT INTO profiles (id, role, full_name, email, approved)
  VALUES (v_uid, p_role::user_role, trim(p_full_name), COALESCE(v_email, ''), NULL)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, approved = NULL
  RETURNING * INTO v_profile;

  IF p_role = 'student' THEN
    PERFORM link_or_create_student(v_uid, COALESCE(v_email, ''), trim(p_full_name));
  END IF;

  RETURN v_profile;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_profile_setup(TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_profile_setup(TEXT, TEXT) TO authenticated;


-- ── 16. Pin search_path on every SECURITY DEFINER / trigger function ──────
-- Without it, handle_new_user() can't find `profiles` when the auth service
-- (search_path = auth) creates a user ("Database error saving new user"), and
-- SECURITY DEFINER functions could be tricked into using look-alike objects.
DO $$
DECLARE f RECORD;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'get_student_id', 'get_student_lesson_ids', 'get_user_role',
                        'is_approved_teacher', 'jwt_role', 'link_or_create_student',
                        'fn_check_teacher_double_booking', 'fn_lessons_recompute_used',
                        'fn_recompute_lessons_used', 'update_updated_at', 'generate_instalments')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
  END LOOP;
END $$;


-- ── 17. RLS performance: evaluate role checks once per query ──────────────
-- Policies called jwt_role()/auth.uid()/is_approved_teacher() for EVERY row,
-- and the teacher policies rebuilt "all of this teacher's lesson students"
-- (nested, each row re-checking RLS) for every query. A teacher's one-day
-- schedule took ~0.5 s on a modest dataset and grew with history. Same rules,
-- now: role checks run once per statement, and teacher ownership is an
-- indexed lookup per row.

-- Indexed ownership checks (bypass nested RLS; the caller is always auth.uid()).
CREATE OR REPLACE FUNCTION public.teaches_lesson(p_lesson_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM lessons WHERE id = p_lesson_id AND teacher_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.teaches_student(p_student_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
    WHERE ls.student_id = p_student_id AND l.teacher_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.teaches_lesson(UUID), public.teaches_student(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.teaches_lesson(UUID), public.teaches_student(UUID) TO authenticated;

DROP POLICY IF EXISTS "Teachers see own lesson students" ON lesson_students;
CREATE POLICY "Teachers see own lesson students" ON lesson_students FOR SELECT
  USING ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_lesson(lesson_id));

DROP POLICY IF EXISTS "Teachers update own lesson students" ON lesson_students;
CREATE POLICY "Teachers update own lesson students" ON lesson_students FOR UPDATE
  USING ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_lesson(lesson_id));

DROP POLICY IF EXISTS "Teachers insert own lesson students" ON lesson_students;
CREATE POLICY "Teachers insert own lesson students" ON lesson_students FOR INSERT
  WITH CHECK ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_lesson(lesson_id));

DROP POLICY IF EXISTS "Teachers see their lesson students" ON students;
CREATE POLICY "Teachers see their lesson students" ON students FOR SELECT
  USING ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_student(id));

DROP POLICY IF EXISTS "Teachers read own students enrolments" ON student_enrolments;
CREATE POLICY "Teachers read own students enrolments" ON student_enrolments FOR SELECT
  USING ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_student(student_id));

DROP POLICY IF EXISTS "Coordinators manage scheduled_breaks" ON scheduled_breaks;
CREATE POLICY "Coordinators manage scheduled_breaks" ON scheduled_breaks FOR ALL
  USING ((SELECT jwt_role()) = 'coordinator') WITH CHECK ((SELECT jwt_role()) = 'coordinator');

DROP POLICY IF EXISTS "Coordinators manage schedule templates" ON teacher_schedule_templates;
CREATE POLICY "Coordinators manage schedule templates" ON teacher_schedule_templates FOR ALL
  USING ((SELECT jwt_role()) = 'coordinator') WITH CHECK ((SELECT jwt_role()) = 'coordinator');

-- Every other public policy: wrap per-row helper calls in a scalar subquery so
-- Postgres evaluates them once per statement (idempotent: already-wrapped
-- calls are preceded by "SELECT " and skipped).
DO $$
DECLARE
  p RECORD;
  re CONSTANT TEXT := '(?<!SELECT )\m(auth\.uid|auth\.jwt|jwt_role|get_user_role|is_approved_teacher|get_student_id)\(\)';
  new_qual TEXT;
  new_check TEXT;
  stmt TEXT;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (COALESCE(qual, '') ~ re OR COALESCE(with_check, '') ~ re)
  LOOP
    new_qual := regexp_replace(p.qual, re, '( SELECT \1() AS v)', 'g');
    new_check := regexp_replace(p.with_check, re, '( SELECT \1() AS v)', 'g');
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF new_qual IS NOT NULL THEN stmt := stmt || ' USING (' || new_qual || ')'; END IF;
    IF new_check IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || new_check || ')'; END IF;
    EXECUTE stmt;
  END LOOP;
END $$;


-- ── 18. Users can't approve themselves or change their own role ──────────
-- "Users can update own profile" only pinned `role`, so a pending user could
-- set approved = true on their own row and skip coordinator approval.
-- Only coordinators (or server-side functions) may change role/approved.
CREATE OR REPLACE FUNCTION public.guard_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Server-side code (SECURITY DEFINER functions, service role, SQL editor) is trusted.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF jwt_role() = 'coordinator' THEN
    RETURN NEW;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.approved IS DISTINCT FROM OLD.approved
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Only a coordinator can change account role or approval' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_privileged_columns ON profiles;
CREATE TRIGGER trg_guard_profile_privileged_columns
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();

-- The old WITH CHECK re-queried `profiles` from inside a `profiles` policy
-- (infinite recursion → every self-update failed). The trigger above now
-- protects role/approved, so the policy only needs to pin the row owner.
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));


-- ── 19. Security hardening (launch audit) ─────────────────────────────────

-- 19a. link_or_create_student is an internal helper: never callable from the API.
--      (It trusted a caller-supplied p_user_id/p_email → anyone could claim any
--      unlinked child record by email.) complete_profile_setup still calls it.
REVOKE ALL ON FUNCTION public.link_or_create_student(uuid, text, text) FROM public, anon, authenticated;

-- 19b. Only auto-link to a coordinator-created record when the signer-up has a
--      CONFIRMED email that matches; never overwrite the coordinator's name.
CREATE OR REPLACE FUNCTION public.link_or_create_student(p_user_id uuid, p_email text, p_full_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  SELECT id INTO v_student_id FROM students WHERE user_id = p_user_id LIMIT 1;
  IF v_student_id IS NOT NULL THEN
    RETURN v_student_id;
  END IF;

  IF COALESCE(p_email, '') <> '' AND EXISTS (
       SELECT 1 FROM auth.users u
       WHERE u.id = p_user_id
         AND lower(u.email) = lower(p_email)
         AND u.email_confirmed_at IS NOT NULL) THEN
    SELECT id INTO v_student_id
    FROM students
    WHERE lower(email) = lower(p_email) AND user_id IS NULL
    LIMIT 1
    FOR UPDATE;
    IF v_student_id IS NOT NULL THEN
      UPDATE students
      SET user_id = p_user_id,
          full_name = COALESCE(NULLIF(trim(full_name), ''), p_full_name),
          updated_at = now()
      WHERE id = v_student_id;
      RETURN v_student_id;
    END IF;
  END IF;

  BEGIN
    INSERT INTO students (full_name, email, user_id, is_active, payment_plan)
    VALUES (p_full_name, COALESCE(p_email, ''), p_user_id, true, 'trial')
    RETURNING id INTO v_student_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_student_id FROM students WHERE user_id = p_user_id LIMIT 1;
  END;
  RETURN v_student_id;
END;
$$;
REVOKE ALL ON FUNCTION public.link_or_create_student(uuid, text, text) FROM public, anon, authenticated;

-- 19c. Pending/denied students see nothing: a student "is" a student only once approved.
CREATE OR REPLACE FUNCTION public.get_student_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id
  FROM students s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.role = 'student' AND p.approved IS TRUE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_student_lesson_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT ls.lesson_id FROM lesson_students ls WHERE ls.student_id = get_student_id();
$$;

DROP POLICY IF EXISTS "Students see own record" ON students;
CREATE POLICY "Students see own record" ON students FOR SELECT
  USING (id = (SELECT get_student_id()));

-- Self-registration goes through complete_profile_setup (SECURITY DEFINER).
DROP POLICY IF EXISTS "Users can create own student record" ON students;

DROP POLICY IF EXISTS "Students read own breaks" ON scheduled_breaks;
CREATE POLICY "Students read own breaks" ON scheduled_breaks FOR SELECT
  USING ((SELECT get_student_id()) = ANY (student_ids));

DROP POLICY IF EXISTS "Students can view teacher profiles" ON profiles;
CREATE POLICY "Students can view teacher profiles" ON profiles FOR SELECT
  USING ((SELECT get_student_id()) IS NOT NULL AND role = 'teacher');

DROP POLICY IF EXISTS "Students read lesson_rates" ON lesson_rates;
CREATE POLICY "Students read lesson_rates" ON lesson_rates FOR SELECT
  USING ((SELECT get_student_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Students read own invoice files" ON storage.objects;
CREATE POLICY "Students read own invoice files" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND EXISTS (SELECT 1 FROM invoices i
                WHERE i.pdf_path = storage.objects.name
                  AND i.student_id = (SELECT get_student_id()))
  );

-- 19d. lesson-media: students only get files of THEIR lessons (was: every
--      file in the bucket for anyone whose role is 'student', incl. fresh sign-ups).
DROP POLICY IF EXISTS "Students read own lesson media files" ON storage.objects;
CREATE POLICY "Students read own lesson media files" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'lesson-media'
    AND EXISTS (SELECT 1 FROM media_uploads m
                WHERE m.supabase_path = storage.objects.name
                  AND m.lesson_id IN (SELECT get_student_lesson_ids()))
  );

-- 19e. Teachers can't pull arbitrary students into their lessons (which exposed
--      that student's phone/parent contact/fees). Only coordinators enrol.
DROP POLICY IF EXISTS "Teachers insert own lesson students" ON lesson_students;

CREATE OR REPLACE FUNCTION public.guard_lesson_students_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND jwt_role() IS DISTINCT FROM 'coordinator'
     AND (NEW.student_id IS DISTINCT FROM OLD.student_id
          OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id
          OR NEW.enrolment_id IS DISTINCT FROM OLD.enrolment_id) THEN
    RAISE EXCEPTION 'Only a coordinator can move students between lessons' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_lesson_students_update ON lesson_students;
CREATE TRIGGER trg_guard_lesson_students_update
  BEFORE UPDATE ON lesson_students
  FOR EACH ROW EXECUTE FUNCTION guard_lesson_students_update();

-- 19f. Unapproved teachers (anyone can self-register as one) can't touch curriculum.
DROP POLICY IF EXISTS "Teachers create curriculum_resources" ON curriculum_resources;
CREATE POLICY "Teachers create curriculum_resources" ON curriculum_resources FOR INSERT
  WITH CHECK ((SELECT is_approved_teacher()));
DROP POLICY IF EXISTS "Teachers read curriculum_resources" ON curriculum_resources;
DROP POLICY IF EXISTS "Teachers update own curriculum_resources" ON curriculum_resources;
CREATE POLICY "Teachers update own curriculum_resources" ON curriculum_resources FOR UPDATE
  USING ((SELECT is_approved_teacher()) AND (created_by = (SELECT auth.uid()) OR created_by IS NULL));
DROP POLICY IF EXISTS "Teachers delete own curriculum_resources" ON curriculum_resources;
CREATE POLICY "Teachers delete own curriculum_resources" ON curriculum_resources FOR DELETE
  USING ((SELECT is_approved_teacher()) AND (created_by = (SELECT auth.uid()) OR created_by IS NULL));

DROP POLICY IF EXISTS "Teachers view student instruments" ON student_instruments;
CREATE POLICY "Teachers view student instruments" ON student_instruments FOR SELECT
  USING ((SELECT is_approved_teacher()) AND teaches_student(student_id));

-- 19g. Curriculum/reference data: signed-in users only (was readable by anon).
DROP POLICY IF EXISTS "Anyone can view resources" ON curriculum_resources;
CREATE POLICY "Anyone can view resources" ON curriculum_resources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Anyone can view tags" ON curriculum_tags;
CREATE POLICY "Anyone can view tags" ON curriculum_tags FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Anyone can view resource tags" ON curriculum_resource_tags;
CREATE POLICY "Anyone can view resource tags" ON curriculum_resource_tags FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Teachers read lesson_rates" ON lesson_rates;
CREATE POLICY "Teachers read lesson_rates" ON lesson_rates FOR SELECT
  USING ((SELECT is_approved_teacher()));


-- ── 20. A makeup resolves the lesson it replaces (not the oldest pending) ─
-- Rescheduling a specific cancelled lesson used to clear the student's OLDEST
-- pending lesson, so the wrong one could stay in the reschedule list.
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS makeup_for_lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION resolve_pending_on_makeup()
RETURNS TRIGGER AS $$
DECLARE
  v_lesson lessons%ROWTYPE;
BEGIN
  SELECT * INTO v_lesson FROM lessons WHERE id = NEW.lesson_id;
  IF v_lesson.lesson_type <> 'makeup' OR v_lesson.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

  IF v_lesson.makeup_for_lesson_id IS NOT NULL THEN
    UPDATE lessons SET pending_reschedule = false
    WHERE id = v_lesson.makeup_for_lesson_id AND pending_reschedule = true;
    RETURN NEW;
  END IF;

  -- Makeups not tied to a specific lesson clear the oldest outstanding one.
  UPDATE lessons
  SET pending_reschedule = false
  WHERE id = (
    SELECT l.id
    FROM lessons l
    JOIN lesson_students ls ON ls.lesson_id = l.id
    WHERE ls.student_id = NEW.student_id
      AND l.pending_reschedule = true
      AND l.id <> NEW.lesson_id
    ORDER BY l.date, l.start_time
    LIMIT 1
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 21. Renaming a lesson category keeps its rates attached ──────────────
-- Rates reference categories by name; a rename used to orphan them.
CREATE OR REPLACE FUNCTION public.cascade_lesson_category_rename()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE lesson_rates SET category = NEW.name WHERE category = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_cascade_lesson_category_rename ON lesson_categories;
CREATE TRIGGER trg_cascade_lesson_category_rename
  AFTER UPDATE OF name ON lesson_categories
  FOR EACH ROW EXECUTE FUNCTION cascade_lesson_category_rename();


-- ── 22. Free-form lesson categories ────────────────────────────────────────
-- Categories are managed in lesson_categories; the old fixed-list CHECK on
-- lesson_rates.category would reject them. (Also dropped in 00011.)
ALTER TABLE lesson_rates DROP CONSTRAINT IF EXISTS lesson_rates_category_check;


-- ── 23. Realtime for live notifications and schedule refresh ──────────────
-- The app subscribes to changes on these tables; they must be in the
-- Supabase Realtime publication (RLS still decides who receives what).
DO $$
DECLARE t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['notifications', 'lessons'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;


-- ── 24. Teacher double-booking: block overlapping times, not just equal ones
-- Only checked on new lessons or when a lesson's teacher/date/time changes,
-- so editing notes/status on legacy overlapping lessons still works.
CREATE OR REPLACE FUNCTION fn_check_teacher_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_end TIME := COALESCE(NEW.end_time, NEW.start_time + INTERVAL '45 minutes');
  v_clash RECORD;
BEGIN
  IF NEW.teacher_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.teacher_id IS NOT DISTINCT FROM OLD.teacher_id
     AND NEW.date IS NOT DISTINCT FROM OLD.date
     AND NEW.start_time IS NOT DISTINCT FROM OLD.start_time
     AND NEW.end_time IS NOT DISTINCT FROM OLD.end_time
     AND OLD.status <> 'cancelled' THEN
    RETURN NEW;
  END IF;

  SELECT start_time, title INTO v_clash FROM lessons
  WHERE id <> NEW.id
    AND teacher_id = NEW.teacher_id
    AND date = NEW.date
    AND status <> 'cancelled'
    AND start_time < v_end
    AND COALESCE(end_time, start_time + INTERVAL '45 minutes') > NEW.start_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Teacher already has a lesson at % on % (%)',
      to_char(v_clash.start_time, 'HH24:MI'), to_char(NEW.date, 'DD Mon'), v_clash.title;
  END IF;
  RETURN NEW;
END;
$$;


-- ── 25. QA fixes: teacher attendance counts; curriculum ownership ─────────
-- lessons_used recounts ran with the CALLER's permissions. When a teacher
-- marked attendance, the UPDATE on student_enrolments silently matched 0 rows
-- (teachers can't update enrolments), so "lessons left" never moved.
ALTER FUNCTION public.fn_recompute_lessons_used(UUID, TEXT) SECURITY DEFINER;
ALTER FUNCTION public.fn_lesson_students_recompute_used() SECURITY DEFINER;
ALTER FUNCTION public.fn_lessons_recompute_used() SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.fn_recompute_lessons_used(UUID, TEXT) FROM public, anon, authenticated;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT student_id FROM student_enrolments LOOP
    PERFORM fn_recompute_lessons_used(r.student_id, NULL);
  END LOOP;
END $$;

-- An old blanket "teachers manage everything" policy (00010) overrode the
-- owner-only rules: any teacher could edit/delete anyone's curriculum.
DROP POLICY IF EXISTS "Teachers manage resources" ON curriculum_resources;

DROP POLICY IF EXISTS "Teachers manage tags" ON curriculum_tags;
DROP POLICY IF EXISTS "Teachers create tags" ON curriculum_tags;
CREATE POLICY "Teachers create tags" ON curriculum_tags FOR INSERT
  WITH CHECK ((SELECT is_approved_teacher()));

DROP POLICY IF EXISTS "Teachers manage resource tags" ON curriculum_resource_tags;
DROP POLICY IF EXISTS "Teachers tag own resources" ON curriculum_resource_tags;
CREATE POLICY "Teachers tag own resources" ON curriculum_resource_tags FOR ALL
  USING ((SELECT is_approved_teacher()) AND EXISTS (
    SELECT 1 FROM curriculum_resources r WHERE r.id = resource_id AND r.created_by = (SELECT auth.uid())))
  WITH CHECK ((SELECT is_approved_teacher()) AND EXISTS (
    SELECT 1 FROM curriculum_resources r WHERE r.id = resource_id AND r.created_by = (SELECT auth.uid())));

-- Students only see APPROVED teachers' profiles (not pending sign-ups).
DROP POLICY IF EXISTS "Students can view teacher profiles" ON profiles;
CREATE POLICY "Students can view teacher profiles" ON profiles FOR SELECT
  USING ((SELECT get_student_id()) IS NOT NULL AND role = 'teacher' AND approved IS TRUE);


-- ── 26. Breaks in one transaction; group classes continue for others ──────
-- A break for selected students used to cancel the WHOLE lesson, including
-- classmates who aren't on break. Now: if everyone in the lesson is on break
-- the lesson is cancelled (pending reschedule); otherwise only the students on
-- break are moved to a cancelled copy of that lesson (pending reschedule) and
-- the class goes ahead for the rest. p_dry_run = true returns the count only.
CREATE OR REPLACE FUNCTION public.create_break(
  p_title TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_student_ids UUID[],
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_all BOOLEAN := COALESCE(array_length(p_student_ids, 1), 0) = 0;
  v_break_id UUID;
  v_lesson RECORD;
  v_copy UUID;
  v_cancelled INTEGER := 0;
  v_split INTEGER := 0;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can schedule breaks' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date';
  END IF;

  IF NOT p_dry_run THEN
    IF COALESCE(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Please give the break a title'; END IF;
    INSERT INTO scheduled_breaks (created_by, title, start_date, end_date, student_ids, total_cancelled, total_rescheduled)
    VALUES (auth.uid(), trim(p_title), p_start_date, p_end_date, COALESCE(p_student_ids, '{}'), 0, 0)
    RETURNING id INTO v_break_id;
  END IF;

  FOR v_lesson IN
    SELECT l.*,
           (SELECT count(*) FROM lesson_students ls WHERE ls.lesson_id = l.id) AS n_students,
           (SELECT count(*) FROM lesson_students ls WHERE ls.lesson_id = l.id
              AND (v_all OR ls.student_id = ANY(p_student_ids))) AS n_on_break
    FROM lessons l
    WHERE l.status = 'scheduled' AND l.date BETWEEN p_start_date AND p_end_date
  LOOP
    CONTINUE WHEN v_lesson.n_on_break = 0 AND NOT v_all;

    IF v_all OR v_lesson.n_on_break = v_lesson.n_students THEN
      v_cancelled := v_cancelled + 1;
      CONTINUE WHEN p_dry_run;
      UPDATE lessons SET status = 'cancelled', pending_reschedule = true, source_break_id = v_break_id,
                         cancelled_by_role = 'coordinator', cancelled_by_user_id = auth.uid(),
                         cancel_reason = COALESCE(cancel_reason, trim(p_title))
      WHERE id = v_lesson.id;
    ELSE
      -- Some classmates aren't on break: split the break students off.
      v_cancelled := v_cancelled + 1;
      v_split := v_split + 1;
      CONTINUE WHEN p_dry_run;
      INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, status, date, start_time, end_time,
                           title, is_charged, makeup_direction, pending_reschedule, source_break_id,
                           cancelled_by_role, cancelled_by_user_id, cancel_reason)
      VALUES (v_lesson.teacher_id, v_lesson.location_id, v_lesson.instrument_id, v_lesson.lesson_type, 'cancelled',
              v_lesson.date, v_lesson.start_time, v_lesson.end_time, v_lesson.title, v_lesson.is_charged,
              v_lesson.makeup_direction, true, v_break_id, 'coordinator', auth.uid(), trim(p_title))
      RETURNING id INTO v_copy;
      UPDATE lesson_students SET lesson_id = v_copy
      WHERE lesson_id = v_lesson.id AND student_id = ANY(p_student_ids);
    END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    UPDATE scheduled_breaks SET total_cancelled = v_cancelled WHERE id = v_break_id;
  END IF;
  RETURN jsonb_build_object('break_id', v_break_id, 'cancelled', v_cancelled, 'split_group_lessons', v_split);
END;
$$;
REVOKE ALL ON FUNCTION public.create_break(TEXT, DATE, DATE, UUID[], BOOLEAN) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_break(TEXT, DATE, DATE, UUID[], BOOLEAN) TO authenticated;


-- ── 27. Group classes ───────────────────────────────────────────────────────
-- A group is a weekly class (teacher_schedule_templates.is_group) with a member
-- list. Its sessions are lessons with template_id = the group. Each group (and
-- each one-time session) says whether attending counts toward students'
-- lesson allotment (lessons.is_charged → enrolment lessons_used).
ALTER TABLE teacher_schedule_templates
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS counts_toward_lessons BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_students INTEGER;
ALTER TABLE teacher_schedule_templates DROP CONSTRAINT IF EXISTS teacher_schedule_templates_max_students_check;
ALTER TABLE teacher_schedule_templates
  ADD CONSTRAINT teacher_schedule_templates_max_students_check CHECK (max_students IS NULL OR max_students > 0);

ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES teacher_schedule_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_lessons_template_date ON lessons(template_id, date);

CREATE OR REPLACE FUNCTION public._today_ist() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- Internal: weekly sessions for a group between two dates (skips dates that
-- already have a session; reports clashes with the teacher's other lessons).
CREATE OR REPLACE FUNCTION public._generate_group_sessions(p_group_id UUID, p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE;
  v_end TIME;
  v_date DATE;
  v_lesson UUID;
  v_created INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  SELECT * INTO g FROM teacher_schedule_templates WHERE id = p_group_id;
  v_end := COALESCE(g.end_time, g.start_time + INTERVAL '45 minutes');
  FOR v_date IN
    SELECT d::date FROM generate_series(p_from, p_to, INTERVAL '1 day') d
    WHERE EXTRACT(DOW FROM d) = g.day_of_week ORDER BY d
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM lessons WHERE template_id = g.id AND date = v_date);
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = g.teacher_id AND l.date = v_date AND l.status <> 'cancelled'
        AND l.start_time < v_end AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > g.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      CONTINUE;
    END IF;
    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time,
                         title, is_charged, template_id)
    VALUES (g.teacher_id, g.location_id, g.instrument_id, 'regular', v_date, g.start_time, g.end_time,
            g.title, g.counts_toward_lessons, g.id)
    RETURNING id INTO v_lesson;
    INSERT INTO lesson_students (lesson_id, student_id)
    SELECT v_lesson, s FROM unnest(COALESCE(g.student_ids, '{}')) s
    ON CONFLICT DO NOTHING;
    v_created := v_created + 1;
  END LOOP;
  RETURN jsonb_build_object('lessons_created', v_created, 'conflicts', v_conflicts,
                            'conflict_dates', to_jsonb(v_conflict_dates));
END;
$$;
REVOKE ALL ON FUNCTION public._generate_group_sessions(UUID, DATE, DATE) FROM public, anon, authenticated;

-- Internal: load an active group or fail.
CREATE OR REPLACE FUNCTION public._require_group(p_group_id UUID, p_active BOOLEAN DEFAULT true)
RETURNS teacher_schedule_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE g teacher_schedule_templates%ROWTYPE;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can manage groups' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO g FROM teacher_schedule_templates WHERE id = p_group_id AND is_group FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Group not found'; END IF;
  IF p_active AND NOT g.is_active THEN RAISE EXCEPTION 'This group has ended'; END IF;
  RETURN g;
END;
$$;
REVOKE ALL ON FUNCTION public._require_group(UUID, BOOLEAN) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_group(
  p_name TEXT,
  p_teacher_id UUID,
  p_day_of_week INTEGER,
  p_start_time TIME,
  p_end_time TIME,
  p_start_date DATE,
  p_end_date DATE,
  p_student_ids UUID[] DEFAULT '{}',
  p_counts_toward_lessons BOOLEAN DEFAULT true,
  p_instrument_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  p_max_students INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_members UUID[] := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_student_ids, '{}')) s);
  v_id UUID;
  v_result JSONB;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can manage groups' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN RAISE EXCEPTION 'Please give the group a name'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher' AND approved IS TRUE) THEN
    RAISE EXCEPTION 'Please choose an approved teacher';
  END IF;
  IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
    RAISE EXCEPTION 'Choose a day and start time';
  END IF;
  IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after the start date';
  END IF;
  IF p_end_date - p_start_date > 400 THEN RAISE EXCEPTION 'Schedule at most about a year at a time'; END IF;
  IF p_max_students IS NOT NULL AND p_max_students < COALESCE(array_length(v_members, 1), 0) THEN
    RAISE EXCEPTION 'More members than the group''s maximum (%)', p_max_students;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_members) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;

  INSERT INTO teacher_schedule_templates (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id,
                                          title, student_ids, is_active, is_group, counts_toward_lessons, max_students)
  VALUES (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
          trim(p_name), v_members, true, true, COALESCE(p_counts_toward_lessons, true), p_max_students)
  RETURNING id INTO v_id;

  v_result := _generate_group_sessions(v_id, p_start_date, p_end_date);
  RETURN v_result || jsonb_build_object('group_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_group(
  p_group_id UUID,
  p_name TEXT DEFAULT NULL,
  p_counts_toward_lessons BOOLEAN DEFAULT NULL,
  p_max_students INTEGER DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_n INTEGER;
BEGIN
  IF p_name IS NOT NULL AND trim(p_name) = '' THEN RAISE EXCEPTION 'Please give the group a name'; END IF;
  IF p_max_students IS NOT NULL AND p_max_students < COALESCE(array_length(g.student_ids, 1), 0) THEN
    RAISE EXCEPTION 'The group already has % members', array_length(g.student_ids, 1);
  END IF;
  UPDATE teacher_schedule_templates SET
    title = COALESCE(NULLIF(trim(p_name), ''), title),
    counts_toward_lessons = COALESCE(p_counts_toward_lessons, counts_toward_lessons),
    max_students = COALESCE(p_max_students, max_students),
    location_id = COALESCE(p_location_id, location_id),
    updated_at = now()
  WHERE id = g.id RETURNING * INTO g;

  UPDATE lessons SET title = g.title, is_charged = g.counts_toward_lessons,
                     location_id = COALESCE(p_location_id, location_id)
  WHERE template_id = g.id AND status = 'scheduled' AND date >= _today_ist() AND lesson_type = 'regular';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('future_sessions_updated', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.add_group_members(p_group_id UUID, p_student_ids UUID[], p_from_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id);
  v_new UUID[];
  v_joined INTEGER;
BEGIN
  v_new := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_student_ids, '{}')) s
                 WHERE NOT (s = ANY(COALESCE(g.student_ids, '{}'))));
  IF COALESCE(array_length(v_new, 1), 0) = 0 THEN
    RETURN jsonb_build_object('added', 0, 'sessions_joined', 0);
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_new) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;
  IF g.max_students IS NOT NULL
     AND COALESCE(array_length(g.student_ids, 1), 0) + array_length(v_new, 1) > g.max_students THEN
    RAISE EXCEPTION 'This group is full (maximum % students)', g.max_students;
  END IF;

  UPDATE teacher_schedule_templates SET student_ids = COALESCE(student_ids, '{}') || v_new, updated_at = now()
  WHERE id = g.id;

  INSERT INTO lesson_students (lesson_id, student_id)
  SELECT l.id, s FROM lessons l CROSS JOIN unnest(v_new) s
  WHERE l.template_id = g.id AND l.status = 'scheduled' AND l.date >= COALESCE(p_from_date, _today_ist())
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_joined = ROW_COUNT;
  RETURN jsonb_build_object('added', array_length(v_new, 1), 'sessions_joined', v_joined);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_group_member(p_group_id UUID, p_student_id UUID, p_from_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_left INTEGER;
BEGIN
  UPDATE teacher_schedule_templates SET student_ids = array_remove(student_ids, p_student_id), updated_at = now()
  WHERE id = g.id;
  -- Leave not-yet-held sessions; past attendance stays on record.
  DELETE FROM lesson_students ls USING lessons l
  WHERE ls.lesson_id = l.id AND ls.student_id = p_student_id AND l.template_id = g.id
    AND l.status = 'scheduled' AND l.date >= COALESCE(p_from_date, _today_ist());
  GET DIAGNOSTICS v_left = ROW_COUNT;
  RETURN jsonb_build_object('sessions_left', v_left);
END;
$$;

CREATE OR REPLACE FUNCTION public.extend_group_schedule(p_group_id UUID, p_end_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id);
  v_from DATE;
BEGIN
  v_from := GREATEST(_today_ist(),
                     COALESCE((SELECT max(date) + 1 FROM lessons WHERE template_id = g.id), _today_ist()));
  IF p_end_date IS NULL OR p_end_date < v_from THEN
    RAISE EXCEPTION 'Sessions are already scheduled up to that date';
  END IF;
  IF p_end_date - v_from > 400 THEN RAISE EXCEPTION 'Schedule at most about a year at a time'; END IF;
  RETURN _generate_group_sessions(g.id, v_from, p_end_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_group_session(
  p_title TEXT,
  p_teacher_id UUID,
  p_date DATE,
  p_start_time TIME,
  p_end_time TIME DEFAULT NULL,
  p_student_ids UUID[] DEFAULT '{}',
  p_counts_toward_lessons BOOLEAN DEFAULT false,
  p_group_id UUID DEFAULT NULL,
  p_instrument_id UUID DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE;
  v_teacher UUID := p_teacher_id;
  v_members UUID[] := COALESCE(p_student_ids, '{}');
  v_end TIME;
  v_clash RECORD;
  v_lesson UUID;
  v_n INTEGER;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can schedule sessions' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NOT NULL THEN
    g := _require_group(p_group_id);
    v_teacher := COALESCE(p_teacher_id, g.teacher_id);
    v_members := COALESCE(g.student_ids, '{}') || v_members;
  END IF;
  v_members := ARRAY(SELECT DISTINCT s FROM unnest(v_members) s);

  IF COALESCE(trim(p_title), '') = '' THEN RAISE EXCEPTION 'Please give the session a title'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_teacher AND role = 'teacher' AND approved IS TRUE) THEN
    RAISE EXCEPTION 'Please choose an approved teacher';
  END IF;
  IF p_date IS NULL OR p_start_time IS NULL THEN RAISE EXCEPTION 'Choose a date and start time'; END IF;
  IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after the start time';
  END IF;
  IF COALESCE(array_length(v_members, 1), 0) = 0 THEN RAISE EXCEPTION 'Add at least one student'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_members) s WHERE NOT EXISTS (SELECT 1 FROM students WHERE id = s)) THEN
    RAISE EXCEPTION 'One of the selected students no longer exists';
  END IF;

  v_end := COALESCE(p_end_time, p_start_time + INTERVAL '45 minutes');
  SELECT start_time, title INTO v_clash FROM lessons l
  WHERE l.teacher_id = v_teacher AND l.date = p_date AND l.status <> 'cancelled'
    AND l.start_time < v_end AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > p_start_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The teacher already has "%" at % that day', v_clash.title, to_char(v_clash.start_time, 'HH24:MI');
  END IF;

  INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time,
                       title, is_charged, template_id)
  VALUES (v_teacher, COALESCE(p_location_id, g.location_id), COALESCE(p_instrument_id, g.instrument_id),
          'one_time', p_date, p_start_time, p_end_time, trim(p_title), COALESCE(p_counts_toward_lessons, false),
          p_group_id)
  RETURNING id INTO v_lesson;
  INSERT INTO lesson_students (lesson_id, student_id) SELECT v_lesson, s FROM unnest(v_members) s;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('lesson_id', v_lesson, 'students', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.end_group(p_group_id UUID, p_from_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g teacher_schedule_templates%ROWTYPE := _require_group(p_group_id, false);
  v_n INTEGER;
BEGIN
  UPDATE teacher_schedule_templates SET is_active = false, updated_at = now() WHERE id = g.id;
  DELETE FROM lessons
  WHERE template_id = g.id AND status = 'scheduled' AND date >= COALESCE(p_from_date, _today_ist());
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('sessions_removed', v_n);
END;
$$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'create_group(text,uuid,integer,time,time,date,date,uuid[],boolean,uuid,uuid,integer)',
    'update_group(uuid,text,boolean,integer,uuid)',
    'add_group_members(uuid,uuid[],date)',
    'remove_group_member(uuid,uuid,date)',
    'extend_group_schedule(uuid,date)',
    'schedule_group_session(text,uuid,date,time,time,uuid[],boolean,uuid,uuid,uuid)',
    'end_group(uuid,date)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;


-- ── 28. Calendar sync (private subscribe links) ───────────────────────────
-- ── Calendar sync: private per-user iCalendar feed tokens ────────────────
-- Calendar apps (Google / Apple / Outlook) subscribe to a URL and cannot send
-- login headers, so each user gets a secret, unguessable token that the
-- `calendar-feed` edge function (service role, verify_jwt = false) resolves to
-- a user. Tokens are only ever created / rotated through the RPCs below;
-- users may read their own row, nobody may write it directly.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.calendar_tokens (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_tokens ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner; no INSERT/UPDATE/DELETE policies → writes only via
-- the SECURITY DEFINER RPCs (or the service role).
REVOKE ALL ON TABLE public.calendar_tokens FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.calendar_tokens TO authenticated;

DROP POLICY IF EXISTS "Users read own calendar token" ON public.calendar_tokens;
CREATE POLICY "Users read own calendar token" ON public.calendar_tokens
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Internal helper: 32 random bytes → 43-char url-safe base64 (no padding).
CREATE OR REPLACE FUNCTION public.new_calendar_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;
REVOKE ALL ON FUNCTION public.new_calendar_token() FROM public, anon, authenticated;

-- Internal helper: who may have a calendar feed? Approved teachers/students,
-- and coordinators. Raises a human-readable error otherwise.
CREATE OR REPLACE FUNCTION public.assert_calendar_feed_allowed()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role user_role;
  v_approved boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT role, approved INTO v_role, v_approved FROM profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account is not set up yet' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'coordinator' AND v_approved IS NOT TRUE THEN
    RAISE EXCEPTION 'Your account is awaiting approval — calendar sync is available once a coordinator approves it'
      USING ERRCODE = '42501';
  END IF;
  RETURN v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_calendar_feed_allowed() FROM public, anon, authenticated;

-- Returns the caller's feed token, creating one on first use.
CREATE OR REPLACE FUNCTION public.get_calendar_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.assert_calendar_feed_allowed();
  v_token text;
BEGIN
  SELECT token INTO v_token FROM calendar_tokens WHERE user_id = v_uid;
  IF v_token IS NOT NULL THEN
    RETURN v_token;
  END IF;

  INSERT INTO calendar_tokens (user_id, token)
  VALUES (v_uid, public.new_calendar_token())
  ON CONFLICT (user_id) DO NOTHING;

  SELECT token INTO v_token FROM calendar_tokens WHERE user_id = v_uid;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.get_calendar_token() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_token() TO authenticated;

-- Rotates the caller's token: the old feed URL stops working immediately.
CREATE OR REPLACE FUNCTION public.reset_calendar_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.assert_calendar_feed_allowed();
  v_token text := public.new_calendar_token();
BEGIN
  INSERT INTO calendar_tokens (user_id, token, created_at)
  VALUES (v_uid, v_token, now())
  ON CONFLICT (user_id) DO UPDATE
    SET token = EXCLUDED.token, created_at = EXCLUDED.created_at;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.reset_calendar_token() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reset_calendar_token() TO authenticated;


-- ── 29. Undo a payment; payment method/reference; payment event log ──────
-- ── Payments: undo a payment, payment method/reference, payment event log ──
-- Idempotent: safe to run more than once.
--
-- * payment_records.payment_method / payment_reference — how the money came
--   in (recorded in the Mark Paid dialog, shown on Paid rows + receipt).
-- * payment_events — who marked/undid which payment, for accountability.
--   Coordinators can read it; only the SECURITY DEFINER functions below write.
-- * undo_payment(p_payment_id) — puts a wrongly-marked payment back to unpaid
--   and removes its invoice row (invoices.payment_id is UNIQUE, so the row has
--   to go for the payment to be re-invoiced). The cancelled invoice number is
--   never reused: next_invoice_number() keeps counting in invoice_counters,
--   and the number is kept in payment_events. Returns the invoice file path
--   so the app deletes the file through the Storage API.

-- 1. How the payment was made ------------------------------------------------
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS payment_reference TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'payment_records_payment_method_check'
                    AND conrelid = 'public.payment_records'::regclass) THEN
    ALTER TABLE payment_records ADD CONSTRAINT payment_records_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('cash', 'upi', 'bank_transfer', 'cheque', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'payment_records_payment_reference_length'
                    AND conrelid = 'public.payment_records'::regclass) THEN
    ALTER TABLE payment_records ADD CONSTRAINT payment_records_payment_reference_length
      CHECK (payment_reference IS NULL OR char_length(payment_reference) <= 100);
  END IF;
END $$;

-- 2. Event log ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL (not CASCADE): the log outlives a deleted payment record.
  payment_id     UUID REFERENCES payment_records(id) ON DELETE SET NULL,
  event          TEXT NOT NULL CHECK (event IN ('marked_paid', 'undo_paid')),
  amount         NUMERIC(10,2),
  invoice_number TEXT,
  paid_date      DATE,
  actor          UUID,          -- auth.uid() of whoever did it (NULL = system / service role)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id, created_at);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Coordinators read payment events" ON payment_events;
CREATE POLICY "Coordinators read payment events" ON payment_events
  FOR SELECT USING ((SELECT jwt_role()) = 'coordinator');
REVOKE ALL ON payment_events FROM public, anon, authenticated;
GRANT SELECT ON payment_events TO authenticated;
GRANT ALL ON payment_events TO service_role;

-- 3. Log 'marked_paid' whenever a payment goes unpaid → paid ------------------
CREATE OR REPLACE FUNCTION public.log_payment_marked_paid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO payment_events (payment_id, event, amount, paid_date, actor)
  VALUES (NEW.id, 'marked_paid', NEW.amount, NEW.paid_date, auth.uid());
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.log_payment_marked_paid() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS trg_payment_marked_paid ON payment_records;
CREATE TRIGGER trg_payment_marked_paid
  AFTER UPDATE OF paid_date ON payment_records
  FOR EACH ROW
  WHEN (OLD.paid_date IS NULL AND NEW.paid_date IS NOT NULL)
  EXECUTE FUNCTION public.log_payment_marked_paid();

-- 4. undo_payment ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.undo_payment(p_payment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay payment_records%ROWTYPE;
  v_invoice_number TEXT;
  v_pdf_path TEXT;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can undo a payment' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pay FROM payment_records WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF v_pay.paid_date IS NULL THEN
    RAISE EXCEPTION 'This payment is not marked as paid — nothing to undo';
  END IF;

  DELETE FROM invoices WHERE payment_id = p_payment_id
    RETURNING invoice_number, pdf_path INTO v_invoice_number, v_pdf_path;

  UPDATE payment_records
     SET paid_date = NULL,
         verified_at = NULL,
         verified_by = NULL,
         reminder_sent = false,
         payment_method = NULL,
         payment_reference = NULL
   WHERE id = p_payment_id;

  INSERT INTO payment_events (payment_id, event, amount, invoice_number, paid_date, actor)
  VALUES (p_payment_id, 'undo_paid', v_pay.amount, v_invoice_number, v_pay.paid_date, auth.uid());

  RETURN jsonb_build_object('invoice_number', v_invoice_number, 'pdf_path', v_pdf_path);
END;
$$;
REVOKE ALL ON FUNCTION public.undo_payment(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.undo_payment(UUID) TO authenticated;

-- 5. Coordinators must be able to delete the invoice file via the Storage API.
--    (Already created by an earlier migration; re-assert it idempotently.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'Coordinators delete invoice files') THEN
    CREATE POLICY "Coordinators delete invoice files" ON storage.objects
      FOR DELETE USING (bucket_id = 'invoices' AND get_user_role() = 'coordinator');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- ── 30. In-app absence requests (students/parents → coordinator) ─────────
-- ── Absence / cancellation requests (students & parents → coordinator) ────
-- Cancellations happen in the app, not on WhatsApp. A student (or a parent on
-- the student's login) asks not to attend an upcoming lesson; a coordinator
-- approves (charged / not charged) or declines it.
--   • Less than 24 hours before the lesson = late notice → charged by default.
--   • Approve: that student is marked absent on the lesson. If they're the only
--     student, the lesson is cancelled too, and (when not charged) it goes to
--     the reschedule queue (pending_reschedule). Group classes go ahead for
--     everyone else.
--   • Writes only through the RPCs below; the table has read policies only.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.absence_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  late_notice   BOOLEAN NOT NULL DEFAULT false,
  charged       BOOLEAN,
  decided_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.absence_requests DROP CONSTRAINT IF EXISTS absence_requests_status_check;
ALTER TABLE public.absence_requests
  ADD CONSTRAINT absence_requests_status_check CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn'));
ALTER TABLE public.absence_requests DROP CONSTRAINT IF EXISTS absence_requests_reason_check;
ALTER TABLE public.absence_requests
  ADD CONSTRAINT absence_requests_reason_check CHECK (char_length(btrim(reason)) BETWEEN 1 AND 300);
ALTER TABLE public.absence_requests DROP CONSTRAINT IF EXISTS absence_requests_note_check;
ALTER TABLE public.absence_requests
  ADD CONSTRAINT absence_requests_note_check CHECK (decision_note IS NULL OR char_length(decision_note) <= 300);

-- One open request per student per lesson.
CREATE UNIQUE INDEX IF NOT EXISTS uq_absence_requests_pending
  ON public.absence_requests(lesson_id, student_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_absence_requests_student ON public.absence_requests(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_absence_requests_lesson ON public.absence_requests(lesson_id);
CREATE INDEX IF NOT EXISTS idx_absence_requests_status ON public.absence_requests(status, created_at DESC);

ALTER TABLE public.absence_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students read own absence requests" ON public.absence_requests;
CREATE POLICY "Students read own absence requests" ON public.absence_requests FOR SELECT
  USING (student_id = (SELECT get_student_id()));

DROP POLICY IF EXISTS "Coordinators read absence requests" ON public.absence_requests;
CREATE POLICY "Coordinators read absence requests" ON public.absence_requests FOR SELECT
  USING ((SELECT jwt_role()) = 'coordinator');

DROP POLICY IF EXISTS "Teachers read absence requests for own lessons" ON public.absence_requests;
CREATE POLICY "Teachers read absence requests for own lessons" ON public.absence_requests FOR SELECT
  USING ((SELECT jwt_role()) = 'teacher' AND (SELECT is_approved_teacher()) AND teaches_lesson(lesson_id));

-- No insert/update/delete policies: writes go through the functions below.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.absence_requests FROM anon, authenticated;
REVOKE ALL ON public.absence_requests FROM anon;
GRANT SELECT ON public.absence_requests TO authenticated;

-- Internal: "Sun 8 Nov, 6:00 PM" for notification text.
CREATE OR REPLACE FUNCTION public._lesson_when_label(p_date DATE, p_time TIME)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_date, 'Dy FMDD Mon') || ', ' || ltrim(to_char(p_time, 'HH12:MI AM'), '0')
$$;
REVOKE ALL ON FUNCTION public._lesson_when_label(DATE, TIME) FROM public, anon, authenticated;

-- ── Student: ask not to attend a lesson ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_absence(p_lesson_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID := get_student_id();
  v_student_name TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_lesson lessons%ROWTYPE;
  v_starts TIMESTAMPTZ;
  v_late BOOLEAN;
  v_id UUID;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Only enrolled students can request an absence' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'Please tell us why you can''t attend'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'Please keep the reason under 300 characters'; END IF;

  SELECT l.* INTO v_lesson FROM lessons l
  WHERE l.id = p_lesson_id
    AND EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.lesson_id = l.id AND ls.student_id = v_student);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42501';
  END IF;
  IF v_lesson.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This lesson is already %', v_lesson.status;
  END IF;

  v_starts := (v_lesson.date + v_lesson.start_time) AT TIME ZONE 'Asia/Kolkata';
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'This lesson has already started';
  END IF;
  v_late := v_starts < now() + INTERVAL '24 hours';

  IF EXISTS (SELECT 1 FROM absence_requests
             WHERE lesson_id = p_lesson_id AND student_id = v_student AND status = 'approved') THEN
    RAISE EXCEPTION 'Your absence for this lesson is already approved';
  END IF;

  BEGIN
    INSERT INTO absence_requests (lesson_id, student_id, requested_by, reason, late_notice)
    VALUES (p_lesson_id, v_student, auth.uid(), v_reason, v_late)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You''ve already asked to miss this lesson — it''s waiting for approval';
  END;

  -- Let coordinators know (in-app).
  SELECT full_name INTO v_student_name FROM students WHERE id = v_student;
  INSERT INTO notifications (user_id, type, title, body)
  SELECT p.id, 'general', 'Absence request',
         COALESCE(v_student_name, 'A student') || ' can''t attend ' ||
         _lesson_when_label(v_lesson.date, v_lesson.start_time) ||
         CASE WHEN v_late THEN ' (late notice)' ELSE '' END || ': ' || v_reason
  FROM profiles p WHERE p.role = 'coordinator';

  RETURN jsonb_build_object('id', v_id, 'late_notice', v_late);
END;
$$;
REVOKE ALL ON FUNCTION public.request_absence(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_absence(UUID, TEXT) TO authenticated;

-- ── Student: withdraw their own pending request ────────────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_absence_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID := get_student_id();
  v_status TEXT;
BEGIN
  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Only enrolled students can withdraw a request' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM absence_requests
  WHERE id = p_request_id AND student_id = v_student FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', v_status;
  END IF;
  UPDATE absence_requests SET status = 'withdrawn', decided_at = now() WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_absence_request(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_absence_request(UUID) TO authenticated;

-- ── Coordinator: approve or decline ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.decide_absence_request(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_charged BOOLEAN DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r absence_requests%ROWTYPE;
  v_lesson lessons%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_charged BOOLEAN;
  v_n_students INTEGER;
  v_cancelled BOOLEAN := false;
  v_student_user UUID;
  v_student_name TEXT;
  v_when TEXT;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can decide absence requests' USING ERRCODE = '42501';
  END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Choose approve or decline'; END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 300 THEN
    RAISE EXCEPTION 'Please keep the note under 300 characters';
  END IF;

  SELECT * INTO r FROM absence_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', r.status;
  END IF;

  SELECT * INTO v_lesson FROM lessons WHERE id = r.lesson_id FOR UPDATE;
  SELECT user_id, full_name INTO v_student_user, v_student_name FROM students WHERE id = r.student_id;
  v_when := _lesson_when_label(v_lesson.date, v_lesson.start_time);

  IF NOT p_approve THEN
    UPDATE absence_requests
    SET status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    WHERE id = r.id;
    IF v_student_user IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, body)
      VALUES (v_student_user, 'general', 'Absence request declined',
              'Your request to miss the lesson on ' || v_when || ' was declined — please attend as usual.'
              || COALESCE(' Note: ' || v_note, ''));
    END IF;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  IF v_lesson.status = 'cancelled' THEN
    RAISE EXCEPTION 'This lesson has already been cancelled — decline the request instead';
  END IF;

  v_charged := COALESCE(p_charged, r.late_notice);

  UPDATE lesson_students
  SET attended = false,
      absence_category = (CASE WHEN v_charged THEN 'charged' ELSE 'not_charged' END)::absence_category
  WHERE lesson_id = r.lesson_id AND student_id = r.student_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This student is no longer on that lesson — decline the request instead';
  END IF;

  SELECT count(*) INTO v_n_students FROM lesson_students WHERE lesson_id = r.lesson_id;

  -- 1:1 (only this student): the lesson itself is off. Group: goes ahead.
  IF v_n_students = 1 AND v_lesson.status = 'scheduled' THEN
    UPDATE lessons
    SET status = 'cancelled',
        cancel_reason = left('Absence: ' || r.reason, 300),
        cancelled_by_role = 'coordinator',
        cancelled_by_user_id = auth.uid(),
        cancelled_by_student_id = r.student_id,
        pending_reschedule = NOT v_charged
    WHERE id = r.lesson_id;
    v_cancelled := true;
  END IF;

  UPDATE absence_requests
  SET status = 'approved', charged = v_charged, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
  WHERE id = r.id;

  IF v_student_user IS NOT NULL THEN
    INSERT INTO notifications (user_id, type, title, body)
    VALUES (v_student_user,
            CASE WHEN v_cancelled THEN 'lesson_cancelled' ELSE 'lesson_updated' END::notification_type,
            'Absence approved',
            'You''re excused from the lesson on ' || v_when || '. '
            || CASE WHEN v_charged THEN 'This lesson will still be charged.'
                    WHEN v_cancelled THEN 'It won''t be charged — we''ll reschedule it.'
                    ELSE 'It won''t be charged.' END
            || COALESCE(' Note: ' || v_note, ''));
  END IF;

  INSERT INTO notifications (user_id, type, title, body)
  VALUES (v_lesson.teacher_id,
          CASE WHEN v_cancelled THEN 'lesson_cancelled' ELSE 'lesson_updated' END::notification_type,
          CASE WHEN v_cancelled THEN 'Lesson cancelled — student absent' ELSE 'Student absent' END,
          COALESCE(v_student_name, 'A student') || ' won''t attend the lesson on ' || v_when || '.'
          || CASE WHEN v_cancelled THEN ' The lesson is cancelled.' ELSE ' The class goes ahead for the others.' END);

  RETURN jsonb_build_object('status', 'approved', 'charged', v_charged, 'lesson_cancelled', v_cancelled);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_absence_request(UUID, BOOLEAN, BOOLEAN, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.decide_absence_request(UUID, BOOLEAN, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ── 31. Charged absences always use up a lesson ─────────────────────────────
-- An approved late-notice absence on a 1:1 lesson cancels the lesson; it must
-- still count toward the student's lessons used.
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
          -- A held lesson counts; so does a charged absence even if the
          -- lesson itself was cancelled (e.g. approved late-notice absence).
          AND (l.status = 'completed' OR (l.status = 'cancelled' AND lst.absence_category = 'charged'))
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
ALTER FUNCTION public.fn_recompute_lessons_used(UUID, TEXT) SECURITY DEFINER;

-- Recount when attendance/absence changes on a cancelled lesson too (the
-- lesson_students trigger already fires on every change).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT student_id FROM student_enrolments LOOP
    PERFORM fn_recompute_lessons_used(r.student_id, NULL);
  END LOOP;
END $$;


-- ── 32. Substitute teacher: move lessons to another teacher ──────────────
-- ── Substitute teacher: give a teacher's lessons to another teacher ─────────
-- When a teacher can't come in, the coordinator reassigns one lesson (or a
-- whole day of them) to a substitute. The lesson's teacher_id changes, so the
-- substitute sees it (RLS is by teacher_id) and the absent teacher no longer
-- does. substitute_for_teacher_id remembers who the lesson originally
-- belonged to (set only the first time; cleared if it goes back to them).
-- Lessons that would clash with the substitute's other lessons are skipped and
-- reported instead of failing the whole batch.
ALTER TABLE lessons
  ADD COLUMN IF NOT EXISTS substitute_for_teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reassign_reason TEXT;

CREATE OR REPLACE FUNCTION public.reassign_lessons(
  p_lesson_ids UUID[],
  p_new_teacher_id UUID,
  p_new_start_time TIME DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_sub RECORD;
  v_l RECORD;
  v_clash RECORD;
  v_start TIME;
  v_end TIME;
  v_moved INTEGER := 0;
  v_skipped JSONB := '[]'::jsonb;
  v_info JSONB := '[]'::jsonb;   -- one object per moved lesson, for notifications
  v_id UUID;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can reassign lessons' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(p_lesson_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Choose at least one lesson to reassign';
  END IF;

  SELECT id, full_name INTO v_sub FROM profiles
  WHERE id = p_new_teacher_id AND role = 'teacher' AND approved IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an approved teacher to take these lessons';
  END IF;

  -- Serialise reassignments onto the same substitute so two coordinators
  -- can't both pass the clash check for the same slot.
  PERFORM pg_advisory_xact_lock(hashtext('reassign_lessons:' || p_new_teacher_id::text));

  -- Ids that don't exist.
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(p_lesson_ids) AS x
    WHERE x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lessons WHERE id = x)
  LOOP
    v_skipped := v_skipped || jsonb_build_object('lesson_id', v_id, 'reason', 'Lesson not found');
  END LOOP;

  FOR v_l IN
    SELECT l.*, p.full_name AS teacher_name
    FROM lessons l LEFT JOIN profiles p ON p.id = l.teacher_id
    WHERE l.id = ANY(p_lesson_ids)
    ORDER BY l.date, l.start_time
    FOR UPDATE OF l
  LOOP
    IF v_l.status <> 'scheduled' THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('Lesson is %s — only scheduled lessons can be reassigned', v_l.status));
      CONTINUE;
    END IF;
    IF v_l.teacher_id = p_new_teacher_id THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('Already taught by %s', v_sub.full_name));
      CONTINUE;
    END IF;

    v_start := COALESCE(p_new_start_time, v_l.start_time);
    -- Keep the lesson's length when the time changes.
    v_end := CASE WHEN v_l.end_time IS NULL THEN NULL
                  ELSE v_start + (v_l.end_time - v_l.start_time) END;
    IF v_end IS NOT NULL AND v_end <= v_start THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', 'The new time would run past midnight');
      CONTINUE;
    END IF;

    -- Same rule as fn_check_teacher_double_booking (end = end_time or start + 45 min).
    SELECT start_time, title INTO v_clash FROM lessons
    WHERE id <> v_l.id
      AND teacher_id = p_new_teacher_id
      AND date = v_l.date
      AND status <> 'cancelled'
      AND start_time < COALESCE(v_end, v_start + INTERVAL '45 minutes')
      AND COALESCE(end_time, start_time + INTERVAL '45 minutes') > v_start
    ORDER BY start_time
    LIMIT 1;
    IF FOUND THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id,
        'reason', format('%s already has a lesson at %s (%s)', v_sub.full_name,
                         to_char(v_clash.start_time, 'HH24:MI'), COALESCE(NULLIF(v_clash.title, ''), 'Lesson')));
      CONTINUE;
    END IF;

    BEGIN
      UPDATE lessons SET
        teacher_id = p_new_teacher_id,
        start_time = v_start,
        end_time = v_end,
        -- Back to the original teacher → no longer a substitution.
        substitute_for_teacher_id = CASE WHEN substitute_for_teacher_id = p_new_teacher_id THEN NULL
                                         ELSE COALESCE(substitute_for_teacher_id, v_l.teacher_id) END,
        reassign_reason = CASE WHEN substitute_for_teacher_id = p_new_teacher_id THEN NULL
                               ELSE COALESCE(v_reason, reassign_reason) END
      WHERE id = v_l.id;
    EXCEPTION WHEN raise_exception OR check_violation THEN
      v_skipped := v_skipped || jsonb_build_object('lesson_id', v_l.id, 'reason', SQLERRM);
      CONTINUE;
    END;

    v_moved := v_moved + 1;
    v_info := v_info || jsonb_build_object(
      'id', v_l.id, 'date', v_l.date, 'old_start', v_l.start_time, 'new_start', v_start,
      'title', COALESCE(NULLIF(v_l.title, ''), 'Lesson'),
      'old_teacher_id', v_l.teacher_id, 'old_teacher_name', COALESCE(v_l.teacher_name, 'another teacher'),
      'is_return', v_l.substitute_for_teacher_id IS NOT DISTINCT FROM p_new_teacher_id);
  END LOOP;

  IF v_moved > 0 THEN
    -- The substitute: one notification per day covered (or "back with you"
    -- when lessons return to their original teacher).
    INSERT INTO notifications (user_id, type, title, body)
    SELECT p_new_teacher_id, 'lesson_updated',
           CASE WHEN bool_and(m.is_return) THEN
                  CASE WHEN count(*) = 1 THEN 'A lesson is back with you'
                       ELSE format('%s lessons are back with you', count(*)) END
                WHEN count(*) = 1 THEN 'You''re covering a lesson'
                ELSE format('You''re covering %s lessons', count(*)) END,
           format('%s %s %s: %s.%s',
                  to_char(m.date, 'Dy DD Mon'),
                  CASE WHEN bool_and(m.is_return) THEN 'from' ELSE 'for' END,
                  string_agg(DISTINCT m.old_teacher_name, ', '),
                  string_agg(to_char(m.new_start, 'HH24:MI') || ' ' || m.title, ', ' ORDER BY m.new_start),
                  COALESCE(' Reason: ' || v_reason, ''))
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, new_start TIME, title TEXT, old_teacher_name TEXT, is_return BOOLEAN)
    GROUP BY m.date;

    -- The teacher(s) the lessons were taken from.
    INSERT INTO notifications (user_id, type, title, body)
    SELECT m.old_teacher_id, 'lesson_updated',
           CASE WHEN count(*) = 1 THEN 'Your lesson has been reassigned'
                ELSE format('%s of your lessons have been reassigned', count(*)) END,
           format('%s: %s will be taught by %s.',
                  to_char(m.date, 'Dy DD Mon'),
                  string_agg(to_char(m.old_start, 'HH24:MI') || ' ' || m.title, ', ' ORDER BY m.old_start),
                  v_sub.full_name)
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, old_start TIME, title TEXT, old_teacher_id UUID)
    WHERE m.old_teacher_id IS NOT NULL
    GROUP BY m.old_teacher_id, m.date;

    -- Every student (with a login) in the moved lessons.
    INSERT INTO notifications (user_id, type, title, body)
    SELECT DISTINCT s.user_id, 'lesson_updated'::notification_type, 'Lesson teacher changed',
           format('Your lesson (%s) on %s at %s will be taught by %s%s.',
                  m.title, to_char(m.date, 'Dy DD Mon'), to_char(m.new_start, 'HH24:MI'), v_sub.full_name,
                  CASE WHEN m.new_start <> m.old_start
                       THEN format(' (moved from %s)', to_char(m.old_start, 'HH24:MI')) ELSE '' END)
    FROM jsonb_to_recordset(v_info) AS m(id UUID, date DATE, old_start TIME, new_start TIME, title TEXT)
    JOIN lesson_students ls ON ls.lesson_id = m.id
    JOIN students s ON s.id = ls.student_id
    WHERE s.user_id IS NOT NULL;
  END IF;

  RETURN jsonb_build_object('moved', v_moved, 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.reassign_lessons(UUID[], UUID, TIME, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reassign_lessons(UUID[], UUID, TIME, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ── 33. Year rollover: renew students for next year (keep/drop/add classes) ─
-- ── Year rollover: re-enrol students for next year ────────────────────────
-- (feature file: year_rollover.sql — idempotent, safe to re-run)
--  a. student_enrolments.template_id: the class's weekly slot (was unknown:
--     an enrolment had no link to its slot, so a renewal couldn't find it).
--  b. Backfill it for existing enrolments.
--  c. enrol_student stores the slot on the enrolment it creates.
--  d. renewal_candidates(): every active student with classes in a year, with
--     each class's slot/teacher/rate/plan/discounts and what's already renewed.
--  e. rollover_release_slot(): a class dropped at renewal leaves its weekly
--     slot (student_ids drive lesson generation), unless renewed on that slot.

-- a.
ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES teacher_schedule_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_enrolments_template ON student_enrolments(template_id);
CREATE INDEX IF NOT EXISTS idx_enrolments_year ON student_enrolments(academic_year);

-- b1. From the enrolment's own lessons that remember their slot (most common).
UPDATE student_enrolments se
SET template_id = x.template_id
FROM (
  SELECT DISTINCT ON (ls.enrolment_id) ls.enrolment_id, l.template_id
  FROM lesson_students ls
  JOIN lessons l ON l.id = ls.lesson_id
  JOIN teacher_schedule_templates t ON t.id = l.template_id
  WHERE ls.enrolment_id IS NOT NULL AND l.template_id IS NOT NULL
  GROUP BY ls.enrolment_id, l.template_id
  ORDER BY ls.enrolment_id, count(*) DESC, l.template_id
) x
WHERE se.id = x.enrolment_id AND se.template_id IS NULL;

-- b2. From the enrolment's lessons that don't (older ones): the student's slot
--     with that lesson's teacher, weekday and start time (most common).
UPDATE student_enrolments se
SET template_id = x.template_id
FROM (
  SELECT DISTINCT ON (ls.enrolment_id) ls.enrolment_id, t.id AS template_id
  FROM lesson_students ls
  JOIN lessons l ON l.id = ls.lesson_id
  JOIN teacher_schedule_templates t
    ON t.teacher_id = l.teacher_id
   AND t.day_of_week = EXTRACT(DOW FROM l.date)
   AND t.start_time = l.start_time
   AND ls.student_id = ANY(COALESCE(t.student_ids, '{}'))
  WHERE ls.enrolment_id IS NOT NULL
  GROUP BY ls.enrolment_id, t.id, t.is_active
  ORDER BY ls.enrolment_id, count(*) DESC, t.is_active DESC, t.id
) x
WHERE se.id = x.enrolment_id AND se.template_id IS NULL;

-- b3. Else a slot the student is on with the same instrument (active, 1:1 first),
--     not already claimed by another of the student's enrolments that year.
DO $$
DECLARE r RECORD; v_tpl UUID;
BEGIN
  FOR r IN SELECT id, student_id, instrument_id, academic_year FROM student_enrolments
           WHERE template_id IS NULL ORDER BY created_at, id LOOP
    SELECT t.id INTO v_tpl
    FROM teacher_schedule_templates t
    WHERE r.student_id = ANY(COALESCE(t.student_ids, '{}'))
      AND t.instrument_id IS NOT DISTINCT FROM r.instrument_id
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                      WHERE o.student_id = r.student_id AND o.academic_year = r.academic_year
                        AND o.template_id = t.id)
    ORDER BY t.is_active DESC, t.is_group, t.created_at, t.id
    LIMIT 1;
    IF v_tpl IS NOT NULL THEN
      UPDATE student_enrolments SET template_id = v_tpl WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- c. enrol_student: identical to §12 except it also stores template_id.
CREATE OR REPLACE FUNCTION public.enrol_student(
  p_student_id UUID,
  p_teacher_id UUID,
  p_payment_plan payment_plan,
  p_start_date DATE,
  p_end_date DATE,
  p_total_lessons INTEGER,
  p_rate_per_lesson NUMERIC,
  p_total_fee NUMERIC,
  p_registration_fee NUMERIC DEFAULT 0,
  p_lesson_rate_id UUID DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL,
  p_discount_primary TEXT DEFAULT 'none',
  p_discount_multilesson BOOLEAN DEFAULT false,
  p_discount_value NUMERIC DEFAULT 0,
  -- slot: either an existing template …
  p_template_id UUID DEFAULT NULL,
  -- … or a new one
  p_day_of_week INTEGER DEFAULT NULL,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_instrument_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tpl teacher_schedule_templates%ROWTYPE;
  v_enrolment_id UUID;
  v_location UUID;
  v_end_time TIME;
  v_date DATE;
  v_existing RECORD;
  v_lesson_id UUID;
  v_created INTEGER := 0;
  v_joined INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can enrol students' USING ERRCODE = '42501';
  END IF;

  -- ── validation ──
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher') THEN
    RAISE EXCEPTION 'Please choose a teacher';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'End date must be after the start date';
  END IF;
  IF p_total_lessons IS NULL OR p_total_lessons < 1 OR p_total_lessons > 60 THEN
    RAISE EXCEPTION 'Number of lessons must be between 1 and 60';
  END IF;
  IF COALESCE(p_rate_per_lesson, -1) < 0 OR COALESCE(p_total_fee, -1) < 0
     OR COALESCE(p_registration_fee, 0) < 0 OR COALESCE(p_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Fees and discounts cannot be negative';
  END IF;
  IF p_payment_plan <> 'trial' AND p_rate_per_lesson <= 0 THEN
    RAISE EXCEPTION 'Enter a lesson rate greater than ₹0 (or choose the Trial plan)';
  END IF;

  -- ── slot ──
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM teacher_schedule_templates WHERE id = p_template_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That schedule slot no longer exists';
    END IF;
    IF v_tpl.teacher_id <> p_teacher_id THEN
      RAISE EXCEPTION 'That slot belongs to a different teacher — pick a slot for the selected teacher';
    END IF;
    IF NOT (p_student_id = ANY(COALESCE(v_tpl.student_ids, '{}'))) THEN
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = p_template_id;
    END IF;
  ELSE
    IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
      RAISE EXCEPTION 'Choose a day and start time for the new slot';
    END IF;
    IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
      RAISE EXCEPTION 'Slot end time must be after the start time';
    END IF;
    INSERT INTO teacher_schedule_templates
      (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids, is_active)
    VALUES
      (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
       COALESCE(NULLIF(trim(p_title), ''), 'Lesson'), ARRAY[p_student_id], true)
    RETURNING * INTO v_tpl;
  END IF;

  v_location := COALESCE(v_tpl.location_id, p_location_id,
                         (SELECT location_id FROM students WHERE id = p_student_id));
  v_end_time := COALESCE(v_tpl.end_time, v_tpl.start_time + INTERVAL '45 minutes');

  -- ── enrolment ──
  INSERT INTO student_enrolments (
    student_id, academic_year, lesson_rate_id, total_lessons, lessons_used, start_date,
    payment_plan, rate_per_lesson, total_fee, registration_fee, instrument_id,
    discount_primary, discount_multilesson, discount_value, template_id
  ) VALUES (
    p_student_id, COALESCE(NULLIF(p_academic_year, ''), to_char(p_start_date, 'YYYY')), p_lesson_rate_id,
    p_total_lessons, 0, p_start_date, p_payment_plan, p_rate_per_lesson, p_total_fee,
    COALESCE(p_registration_fee, 0), COALESCE(v_tpl.instrument_id, p_instrument_id),
    COALESCE(p_discount_primary, 'none'), COALESCE(p_discount_multilesson, false),
    CASE WHEN p_discount_primary = 'special' THEN COALESCE(p_discount_value, 0) ELSE 0 END,
    v_tpl.id  -- year rollover: remember the class's weekly slot
  ) RETURNING id INTO v_enrolment_id;

  -- ── lessons: weekly on the slot's day, from start date, until enough ──
  FOR v_date IN
    SELECT d::date FROM generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS d
    WHERE EXTRACT(DOW FROM d) = v_tpl.day_of_week
    ORDER BY d
  LOOP
    EXIT WHEN v_created + v_joined >= p_total_lessons;

    -- Same slot already has a lesson that day (e.g. a group class): join it.
    SELECT l.id, l.instrument_id INTO v_existing
    FROM lessons l
    WHERE l.teacher_id = p_teacher_id AND l.date = v_date AND l.start_time = v_tpl.start_time
      AND l.status <> 'cancelled'
    LIMIT 1;

    IF FOUND THEN
      -- Only join when the coordinator deliberately picked an existing slot;
      -- a NEW slot at an occupied time is a clash (never merge into someone's 1:1).
      IF p_template_id IS NOT NULL AND v_existing.instrument_id IS NOT DISTINCT FROM v_tpl.instrument_id THEN
        INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
        VALUES (v_existing.id, p_student_id, v_enrolment_id)
        ON CONFLICT (lesson_id, student_id) DO UPDATE SET enrolment_id = EXCLUDED.enrolment_id;
        v_joined := v_joined + 1;
      ELSE
        v_conflicts := v_conflicts + 1;
        v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      END IF;
      CONTINUE;
    END IF;

    -- Teacher busy with a different lesson overlapping this time: don't double-book.
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = p_teacher_id AND l.date = v_date AND l.status <> 'cancelled'
        AND l.start_time < v_end_time
        AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > v_tpl.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_date::text);
      CONTINUE;
    END IF;

    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time, title,
                         template_id, is_charged)
    VALUES (p_teacher_id, v_location, v_tpl.instrument_id, 'regular', v_date, v_tpl.start_time, v_tpl.end_time,
            COALESCE(NULLIF(v_tpl.title, ''), 'Lesson'), v_tpl.id, COALESCE(v_tpl.counts_toward_lessons, true))
    RETURNING id INTO v_lesson_id;

    INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
    VALUES (v_lesson_id, p_student_id, v_enrolment_id);
    v_created := v_created + 1;
  END LOOP;

  -- ── instalments ──
  PERFORM generate_instalments(v_enrolment_id);

  RETURN jsonb_build_object(
    'enrolment_id', v_enrolment_id,
    'template_id', v_tpl.id,
    'lessons_created', v_created,
    'lessons_joined', v_joined,
    'lessons_scheduled', v_created + v_joined,
    'lessons_expected', p_total_lessons,
    'conflicts', v_conflicts,
    'conflict_dates', to_jsonb(v_conflict_dates)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID) TO authenticated;


-- d. renewal_candidates: one call for the renewal screen.
--    Returns [{ student_id, full_name, location_id,
--               classes: [{ enrolment_id, instrument_id, instrument_name, template_id,
--                           teacher_id, teacher_name, slot: {..., student_on_slot}|null, rate_per_lesson,
--                           payment_plan, lesson_rate_id, discount_*, total_lessons,
--                           total_fee, start_date }],
--               renewed: [{ enrolment_id, instrument_id, instrument_name, template_id,
--                           rate_per_lesson, payment_plan, total_fee }] }]
--    for every ACTIVE student with an enrolment in p_from_year. `renewed` holds
--    the student's p_to_year enrolments (the screen matches them to classes).
CREATE OR REPLACE FUNCTION public.renewal_candidates(p_from_year TEXT, p_to_year TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_from_year), '') = '' OR COALESCE(trim(p_to_year), '') = '' THEN
    RAISE EXCEPTION 'Choose the year to renew from and to';
  END IF;
  IF p_to_year <= p_from_year THEN
    RAISE EXCEPTION 'The new year must be after the year you renew from';
  END IF;

  WITH cls AS (
    SELECT se.*,
           -- teacher: the slot's, else whoever taught most of this enrolment's lessons
           COALESCE(t.teacher_id, (
             SELECT l.teacher_id FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
             WHERE ls.enrolment_id = se.id
             GROUP BY l.teacher_id ORDER BY count(*) DESC, l.teacher_id LIMIT 1)) AS cls_teacher_id,
           t.id AS t_id, t.day_of_week, t.start_time, t.end_time, t.is_active AS t_active,
           t.is_group, t.title AS t_title, t.instrument_id AS t_instrument_id, t.teacher_id AS t_teacher_id,
           (se.student_id = ANY(COALESCE(t.student_ids, '{}'))) AS t_on_slot
    FROM student_enrolments se
    JOIN students s ON s.id = se.student_id AND s.is_active
    LEFT JOIN teacher_schedule_templates t ON t.id = se.template_id
    WHERE se.academic_year = p_from_year
  ),
  per_student AS (
    SELECT c.student_id,
           jsonb_agg(jsonb_build_object(
             'enrolment_id', c.id,
             'instrument_id', c.instrument_id,
             'instrument_name', i.name,
             'template_id', c.template_id,
             'teacher_id', c.cls_teacher_id,
             'teacher_name', p.full_name,
             'slot', CASE WHEN c.t_id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', c.t_id, 'teacher_id', c.t_teacher_id, 'day_of_week', c.day_of_week,
                        'start_time', c.start_time, 'end_time', c.end_time, 'is_active', c.t_active,
                        'is_group', c.is_group, 'title', c.t_title, 'instrument_id', c.t_instrument_id,
                        'student_on_slot', c.t_on_slot) END,
             'rate_per_lesson', c.rate_per_lesson,
             'payment_plan', c.payment_plan,
             'lesson_rate_id', c.lesson_rate_id,
             'discount_primary', c.discount_primary,
             'discount_multilesson', c.discount_multilesson,
             'discount_value', c.discount_value,
             'total_lessons', c.total_lessons,
             'total_fee', c.total_fee,
             'start_date', c.start_date
           ) ORDER BY i.name NULLS LAST, c.created_at, c.id) AS classes
    FROM cls c
    LEFT JOIN instruments i ON i.id = c.instrument_id
    LEFT JOIN profiles p ON p.id = c.cls_teacher_id
    GROUP BY c.student_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id', s.id,
           'full_name', s.full_name,
           'location_id', s.location_id,
           'classes', ps.classes,
           'renewed', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'enrolment_id', n.id, 'instrument_id', n.instrument_id, 'instrument_name', ni.name,
                      'template_id', n.template_id, 'rate_per_lesson', n.rate_per_lesson,
                      'payment_plan', n.payment_plan, 'total_fee', n.total_fee) ORDER BY n.created_at, n.id)
             FROM student_enrolments n LEFT JOIN instruments ni ON ni.id = n.instrument_id
             WHERE n.student_id = s.id AND n.academic_year = p_to_year), '[]'::jsonb)
         ) ORDER BY s.full_name, s.id), '[]'::jsonb)
  INTO v_result
  FROM per_student ps
  JOIN students s ON s.id = ps.student_id;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.renewal_candidates(TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_candidates(TEXT, TEXT) TO authenticated;


-- e. rollover_release_slot: a class dropped at renewal. Its old-year enrolment
--    stays as history; the student just leaves the weekly slot so lessons
--    generated from the slot for the new year don't include them. Kept when the
--    student was renewed on that same slot. Returns true if they were removed.
CREATE OR REPLACE FUNCTION public.rollover_release_slot(p_student_id UUID, p_template_id UUID, p_to_year TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM student_enrolments
             WHERE student_id = p_student_id AND template_id = p_template_id
               AND academic_year >= p_to_year) THEN
    RETURN false;
  END IF;
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, p_student_id), updated_at = now()
    WHERE id = p_template_id AND p_student_id = ANY(COALESCE(student_ids, '{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.rollover_release_slot(UUID, UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rollover_release_slot(UUID, UUID, TEXT) TO authenticated;


-- ── 34. Family accounts: one login for several children ──────────────────────
-- ── Family accounts: one login for several students ─────────────────────────
-- A parent with two (or more) children at the school uses ONE login.
--   • Each child stays a normal `students` row (own classes, attendance,
--     lessons used, instalments, invoices). Nothing is merged.
--   • The family login is one auth user / one profiles row (role 'student',
--     approved) whose id is set as students.user_id on several students.
--   • The EMAIL is the main way children get linked (coordinator rarely needs
--     the login box):
--       - coordinator adds a student / changes a student's email and it matches
--         an approved (confirmed) student/parent login → linked automatically;
--       - parent signs up with a confirmed email matching coordinator-created
--         students → ALL of them are linked (no extra row named after the
--         parent); a new row is only created when nothing matches;
--       - a login is approved → every still-unlinked student with that email
--         is linked.
--     A user_id that is already set is never overwritten automatically.
--   • Coordinators fix mistakes from the student page (set_student_login:
--     link to a different login, or unlink).
--   • Every student-facing policy and RPC now covers ALL of the login's
--     children via my_student_ids() (pending / rejected logins still get none).
-- Safe to re-run.

-- 1. A login may own several student records (keep the lookup index).
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_user_id_key;
DROP INDEX IF EXISTS public.students_user_id_key;
CREATE INDEX IF NOT EXISTS idx_students_user_id ON public.students(user_id);


-- 2. Identity helpers ─────────────────────────────────────────────────────────
-- All students on the caller's login — only once the login is an APPROVED
-- student/parent account (pending / rejected / teacher / coordinator → none).
CREATE OR REPLACE FUNCTION public.my_student_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id
  FROM students s
  WHERE s.user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles p
                WHERE p.id = auth.uid() AND p.role = 'student' AND p.approved IS TRUE);
$$;
REVOKE ALL ON FUNCTION public.my_student_ids() FROM public;
-- anon keeps EXECUTE (like get_student_id): it returns nothing without a
-- login, and policies on profiles / lesson_rates must not turn an anonymous
-- read into a permission error.
GRANT EXECUTE ON FUNCTION public.my_student_ids() TO anon, authenticated;

-- Kept for any leftover caller: the login's first (oldest) student.
CREATE OR REPLACE FUNCTION public.get_student_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id
  FROM students s
  JOIN profiles p ON p.id = s.user_id
  WHERE s.user_id = auth.uid() AND p.role = 'student' AND p.approved IS TRUE
  ORDER BY s.created_at, s.id
  LIMIT 1;
$$;

-- Lessons of ANY of the login's children.
CREATE OR REPLACE FUNCTION public.get_student_lesson_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ls.lesson_id
  FROM lesson_students ls
  WHERE ls.student_id IN (SELECT my_student_ids());
$$;


-- 3. Student-facing policies → all of the login's children ──────────────────
DROP POLICY IF EXISTS "Students see own record" ON public.students;
CREATE POLICY "Students see own record" ON public.students FOR SELECT
  USING (id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students see own enrollments" ON public.lesson_students;
CREATE POLICY "Students see own enrollments" ON public.lesson_students FOR SELECT
  USING ((SELECT jwt_role()) = 'student' AND student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students see enrolled lessons" ON public.lessons;
CREATE POLICY "Students see enrolled lessons" ON public.lessons FOR SELECT
  USING ((SELECT jwt_role()) = 'student' AND id IN (SELECT get_student_lesson_ids()));

DROP POLICY IF EXISTS "Students see own payments" ON public.payment_records;
CREATE POLICY "Students see own payments" ON public.payment_records FOR SELECT
  USING ((SELECT jwt_role()) = 'student' AND student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students read own invoices" ON public.invoices;
CREATE POLICY "Students read own invoices" ON public.invoices FOR SELECT
  USING ((SELECT get_user_role()) = 'student' AND student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students read own enrolments" ON public.student_enrolments;
CREATE POLICY "Students read own enrolments" ON public.student_enrolments FOR SELECT
  USING ((SELECT get_user_role()) = 'student' AND student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students view own instruments" ON public.student_instruments;
CREATE POLICY "Students view own instruments" ON public.student_instruments FOR SELECT
  USING ((SELECT jwt_role()) = 'student' AND student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students see own pieces" ON public.student_pieces;
CREATE POLICY "Students see own pieces" ON public.student_pieces FOR SELECT
  USING (student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students read own breaks" ON public.scheduled_breaks;
CREATE POLICY "Students read own breaks" ON public.scheduled_breaks FOR SELECT
  USING (student_ids && ARRAY(SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students read own lesson media" ON public.media_uploads;
CREATE POLICY "Students read own lesson media" ON public.media_uploads FOR SELECT
  USING ((SELECT jwt_role()) = 'student' AND lesson_id IN (SELECT get_student_lesson_ids()));

DROP POLICY IF EXISTS "Students read own absence requests" ON public.absence_requests;
CREATE POLICY "Students read own absence requests" ON public.absence_requests FOR SELECT
  USING (student_id IN (SELECT my_student_ids()));

DROP POLICY IF EXISTS "Students can view teacher profiles" ON public.profiles;
CREATE POLICY "Students can view teacher profiles" ON public.profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM my_student_ids()) AND role = 'teacher' AND approved IS TRUE);

DROP POLICY IF EXISTS "Students read lesson_rates" ON public.lesson_rates;
CREATE POLICY "Students read lesson_rates" ON public.lesson_rates FOR SELECT
  USING (EXISTS (SELECT 1 FROM my_student_ids()));

DROP POLICY IF EXISTS "Students read own invoice files" ON storage.objects;
CREATE POLICY "Students read own invoice files" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'invoices'
    AND EXISTS (SELECT 1 FROM public.invoices i
                WHERE i.pdf_path = storage.objects.name
                  AND i.student_id IN (SELECT public.my_student_ids()))
  );

DROP POLICY IF EXISTS "Students read own lesson media files" ON storage.objects;
CREATE POLICY "Students read own lesson media files" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'lesson-media'
    AND EXISTS (SELECT 1 FROM public.media_uploads m
                WHERE m.supabase_path = storage.objects.name
                  AND m.lesson_id IN (SELECT public.get_student_lesson_ids()))
  );


-- 4. Sign-up: link EVERY coordinator-created student with the confirmed email
--    (siblings are often entered with the parent's email). Never overwrites
--    the coordinator's name. Internal helper: not callable from the API.
CREATE OR REPLACE FUNCTION public.link_or_create_student(p_user_id uuid, p_email text, p_full_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  -- user_id is no longer unique: serialise per login so a double submit
  -- can't create two records.
  PERFORM pg_advisory_xact_lock(hashtextextended('link_or_create_student:' || p_user_id::text, 0));

  SELECT id INTO v_student_id FROM students WHERE user_id = p_user_id
  ORDER BY created_at, id LIMIT 1;
  IF v_student_id IS NOT NULL THEN
    RETURN v_student_id;
  END IF;

  IF COALESCE(p_email, '') <> '' AND EXISTS (
       SELECT 1 FROM auth.users u
       WHERE u.id = p_user_id
         AND lower(u.email) = lower(p_email)
         AND u.email_confirmed_at IS NOT NULL) THEN
    WITH matched AS (
      SELECT id FROM students
      WHERE lower(btrim(email)) = lower(btrim(p_email)) AND user_id IS NULL
      FOR UPDATE
    ), linked AS (
      UPDATE students s
      SET user_id = p_user_id,
          full_name = COALESCE(NULLIF(trim(s.full_name), ''), p_full_name),
          updated_at = now()
      FROM matched
      WHERE s.id = matched.id
      RETURNING s.id, s.created_at
    )
    SELECT id INTO v_student_id FROM linked ORDER BY created_at, id LIMIT 1;
    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  INSERT INTO students (full_name, email, user_id, is_active, payment_plan)
  VALUES (p_full_name, COALESCE(p_email, ''), p_user_id, true, 'trial')
  RETURNING id INTO v_student_id;
  RETURN v_student_id;
END;
$$;
REVOKE ALL ON FUNCTION public.link_or_create_student(uuid, text, text) FROM public, anon, authenticated;


-- 4b. Automatic linking by email ────────────────────────────────────────────
-- The approved, confirmed student/parent login that owns this email (if any).
CREATE OR REPLACE FUNCTION public._approved_login_for_email(p_email text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE COALESCE(btrim(p_email), '') <> ''
    AND lower(btrim(p.email)) = lower(btrim(p_email))
    AND p.role = 'student' AND p.approved IS TRUE
    AND u.email_confirmed_at IS NOT NULL
  ORDER BY p.created_at, p.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._approved_login_for_email(text) FROM public, anon, authenticated;

-- Coordinator adds a student, or changes a student's email: link it to the
-- matching login. Never overwrites a user_id that is already set, and an
-- unchanged email never re-links a student the coordinator just unlinked.
CREATE OR REPLACE FUNCTION public.fn_students_link_login_by_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL
     AND COALESCE(btrim(NEW.email), '') <> ''
     AND (TG_OP = 'INSERT' OR lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(COALESCE(OLD.email, '')))) THEN
    NEW.user_id := _approved_login_for_email(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_students_link_login_by_email() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_students_link_login_by_email ON public.students;
CREATE TRIGGER trg_students_link_login_by_email
  BEFORE INSERT OR UPDATE OF email ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.fn_students_link_login_by_email();

-- A student/parent login gets approved: link every still-unlinked student
-- whose email matches its confirmed email (children added while it was pending).
CREATE OR REPLACE FUNCTION public.fn_profiles_link_students_on_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'student' AND NEW.approved IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.approved IS DISTINCT FROM TRUE OR OLD.role IS DISTINCT FROM 'student')
     AND COALESCE(btrim(NEW.email), '') <> ''
     AND EXISTS (SELECT 1 FROM auth.users u
                 WHERE u.id = NEW.id AND u.email_confirmed_at IS NOT NULL
                   AND lower(btrim(u.email)) = lower(btrim(NEW.email))) THEN
    UPDATE students
    SET user_id = NEW.id, updated_at = now()
    WHERE user_id IS NULL AND lower(btrim(email)) = lower(btrim(NEW.email));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_profiles_link_students_on_approval() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_profiles_link_students_on_approval ON public.profiles;
CREATE TRIGGER trg_profiles_link_students_on_approval
  AFTER INSERT OR UPDATE OF approved, role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_profiles_link_students_on_approval();


-- 5. Coordinator: link a student to a (family) login, or unlink ─────────────
-- Returns the login and every student now on it, e.g.
--   {"student_id": …, "login": {"id","full_name","email"} | null,
--    "children": [{"id","full_name","is_active"}, …]}
CREATE OR REPLACE FUNCTION public.set_student_login(p_student_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile profiles%ROWTYPE;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can change a student''s login' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM students WHERE id = p_student_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Student not found'; END IF;

  IF p_user_id IS NOT NULL THEN
    SELECT * INTO v_profile FROM profiles WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That login no longer exists'; END IF;
    IF v_profile.role <> 'student' THEN
      RAISE EXCEPTION 'Only a student / parent login can be linked (this login is a %)', v_profile.role;
    END IF;
    IF v_profile.approved IS NOT TRUE THEN
      RAISE EXCEPTION 'This login isn''t approved yet — approve it first, then link it';
    END IF;
  END IF;

  UPDATE students SET user_id = p_user_id, updated_at = now() WHERE id = p_student_id;

  RETURN jsonb_build_object(
    'student_id', p_student_id,
    'login', CASE WHEN p_user_id IS NULL THEN NULL ELSE
      jsonb_build_object('id', v_profile.id, 'full_name', v_profile.full_name, 'email', v_profile.email) END,
    'children', CASE WHEN p_user_id IS NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name, 'is_active', s.is_active)
                       ORDER BY s.full_name, s.id)
      FROM students s WHERE s.user_id = p_user_id), '[]'::jsonb) END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_student_login(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_student_login(uuid, uuid) TO authenticated;


-- 6. Absence requests for any of the login's children (§30) ──────────────────
-- p_student_id is only needed when several of the caller's children are on the
-- same lesson; it must be one of the caller's own children. (Old 2-argument
-- version dropped: PostgREST can't choose between overloads with defaults.)
DROP FUNCTION IF EXISTS public.request_absence(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.request_absence(p_lesson_id UUID, p_reason TEXT, p_student_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student UUID;
  v_n INTEGER;
  v_student_name TEXT;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_lesson lessons%ROWTYPE;
  v_starts TIMESTAMPTZ;
  v_late BOOLEAN;
  v_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM my_student_ids()) THEN
    RAISE EXCEPTION 'Only enrolled students can request an absence' USING ERRCODE = '42501';
  END IF;
  IF p_student_id IS NOT NULL AND p_student_id NOT IN (SELECT my_student_ids()) THEN
    RAISE EXCEPTION 'That student isn''t on your account' USING ERRCODE = '42501';
  END IF;
  IF v_reason = '' THEN RAISE EXCEPTION 'Please tell us why you can''t attend'; END IF;
  IF char_length(v_reason) > 300 THEN RAISE EXCEPTION 'Please keep the reason under 300 characters'; END IF;

  -- Which of the caller's children on this lesson is it for?
  SELECT count(*), min(ls.student_id::text)::uuid INTO v_n, v_student
  FROM lesson_students ls
  WHERE ls.lesson_id = p_lesson_id
    AND ls.student_id IN (SELECT my_student_ids())
    AND (p_student_id IS NULL OR ls.student_id = p_student_id);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42501';
  END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'More than one of your children is in this lesson — choose which one can''t attend';
  END IF;

  SELECT l.* INTO v_lesson FROM lessons l WHERE l.id = p_lesson_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lesson not found' USING ERRCODE = '42501';
  END IF;
  IF v_lesson.status <> 'scheduled' THEN
    RAISE EXCEPTION 'This lesson is already %', v_lesson.status;
  END IF;

  v_starts := (v_lesson.date + v_lesson.start_time) AT TIME ZONE 'Asia/Kolkata';
  IF v_starts <= now() THEN
    RAISE EXCEPTION 'This lesson has already started';
  END IF;
  v_late := v_starts < now() + INTERVAL '24 hours';

  IF EXISTS (SELECT 1 FROM absence_requests
             WHERE lesson_id = p_lesson_id AND student_id = v_student AND status = 'approved') THEN
    RAISE EXCEPTION 'Your absence for this lesson is already approved';
  END IF;

  BEGIN
    INSERT INTO absence_requests (lesson_id, student_id, requested_by, reason, late_notice)
    VALUES (p_lesson_id, v_student, auth.uid(), v_reason, v_late)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You''ve already asked to miss this lesson — it''s waiting for approval';
  END;

  -- Let coordinators know (in-app).
  SELECT full_name INTO v_student_name FROM students WHERE id = v_student;
  INSERT INTO notifications (user_id, type, title, body)
  SELECT p.id, 'general', 'Absence request',
         COALESCE(v_student_name, 'A student') || ' can''t attend ' ||
         _lesson_when_label(v_lesson.date, v_lesson.start_time) ||
         CASE WHEN v_late THEN ' (late notice)' ELSE '' END || ': ' || v_reason
  FROM profiles p WHERE p.role = 'coordinator';

  RETURN jsonb_build_object('id', v_id, 'late_notice', v_late, 'student_id', v_student);
END;
$$;
REVOKE ALL ON FUNCTION public.request_absence(UUID, TEXT, UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.request_absence(UUID, TEXT, UUID) TO authenticated;

-- Withdraw a pending request of any of the caller's children.
CREATE OR REPLACE FUNCTION public.withdraw_absence_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM my_student_ids()) THEN
    RAISE EXCEPTION 'Only enrolled students can withdraw a request' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM absence_requests
  WHERE id = p_request_id AND student_id IN (SELECT my_student_ids()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = '42501'; END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been %', v_status;
  END IF;
  UPDATE absence_requests SET status = 'withdrawn', decided_at = now() WHERE id = p_request_id;
END;
$$;
REVOKE ALL ON FUNCTION public.withdraw_absence_request(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_absence_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ── 35. Classes 1×/2×/3× per week; rate typed in per class ─────────────────
-- ============================================================================
-- Times per week: one class taught 1×, 2× or 3× a week
-- (feature file: times_per_week.sql — idempotent, safe to re-run)
-- ============================================================================
-- A guitar class twice a week is still ONE class: one enrolment, one instalment
-- schedule, one rate. Each weekly occurrence has its own day/time = its own
-- weekly slot (teacher_schedule_templates row; same teacher and instrument).
--  a. student_enrolments.extra_template_ids: the class's 2nd/3rd weekly slots
--     (template_id stays the first one). A deleted slot drops out of the list.
--  b. enrol_student(… , p_extra_slots): the extra weekly occurrences, each an
--     existing slot { "template_id": uuid } of the same teacher or a new one
--     { "day_of_week": 0-6, "start_time": "HH:MM", "end_time": "HH:MM"|null }.
--     p_total_lessons is the class TOTAL (allotment × times per week); lessons
--     are generated from all occurrences in date order until it is reached.
--  c. delete_enrolment also releases the class's own (extra) slots.
--  d. rollover_release_slot treats an extra slot like the main one.
--  e. renewal_candidates returns each class's extra slots (renewal keeps 2×/week).

-- a. ------------------------------------------------------------------------
ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS extra_template_ids UUID[] NOT NULL DEFAULT '{}';
-- extra_template_ids: the class's 2nd/3rd weekly slots (2×/3× per week); template_id is the first slot.

-- Arrays can't have foreign keys: forget a slot when it is deleted
-- (template_id itself is ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION public.fn_enrolments_forget_deleted_slot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE student_enrolments
    SET extra_template_ids = array_remove(extra_template_ids, OLD.id)
    WHERE OLD.id = ANY(extra_template_ids);
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_enrolments_forget_deleted_slot() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enrolments_forget_deleted_slot ON teacher_schedule_templates;
CREATE TRIGGER trg_enrolments_forget_deleted_slot
  AFTER DELETE ON teacher_schedule_templates
  FOR EACH ROW EXECUTE FUNCTION public.fn_enrolments_forget_deleted_slot();


-- b. enrol_student ----------------------------------------------------------
-- New trailing parameter → drop the old signature first (two overloads with
-- defaults make PostgREST calls ambiguous).
DROP FUNCTION IF EXISTS public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.enrol_student(
  p_student_id UUID,
  p_teacher_id UUID,
  p_payment_plan payment_plan,
  p_start_date DATE,
  p_end_date DATE,
  p_total_lessons INTEGER,
  p_rate_per_lesson NUMERIC,
  p_total_fee NUMERIC,
  p_registration_fee NUMERIC DEFAULT 0,
  p_lesson_rate_id UUID DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL,
  p_discount_primary TEXT DEFAULT 'none',
  p_discount_multilesson BOOLEAN DEFAULT false,
  p_discount_value NUMERIC DEFAULT 0,
  -- first weekly slot: either an existing template …
  p_template_id UUID DEFAULT NULL,
  -- … or a new one
  p_day_of_week INTEGER DEFAULT NULL,
  p_start_time TIME DEFAULT NULL,
  p_end_time TIME DEFAULT NULL,
  p_instrument_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT NULL,
  p_location_id UUID DEFAULT NULL,
  -- 2nd/3rd weekly lesson (2× / 3× per week): [{template_id} | {day_of_week, start_time, end_time}]
  p_extra_slots JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_days CONSTANT TEXT[] := ARRAY['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  v_extras JSONB := COALESCE(p_extra_slots, '[]'::jsonb);
  v_slot_count INTEGER;
  v_max_lessons INTEGER;
  v_tpl teacher_schedule_templates%ROWTYPE;
  v_x teacher_schedule_templates%ROWTYPE;
  v_item JSONB;
  v_n INTEGER;
  v_i INTEGER;
  v_j INTEGER;
  v_raw TEXT;
  v_x_id UUID;
  v_x_day INTEGER;
  v_x_start TIME;
  v_x_end TIME;
  -- one entry per weekly occurrence (1 = the first slot)
  v_tpl_ids UUID[] := '{}';      -- NULL = new slot, created after validation
  v_joinable BOOLEAN[] := '{}';  -- existing slot picked on purpose → may join its lessons
  v_days INTEGER[] := '{}';
  v_starts TIME[] := '{}';
  v_ends TIME[] := '{}';         -- NULL end = 45 minutes (for overlap checks)
  v_new_ends TIME[] := '{}';     -- end time as entered (for new slots)
  v_enrolment_id UUID;
  v_location UUID;
  v_end_time TIME;
  v_occ RECORD;
  v_existing RECORD;
  v_lesson_id UUID;
  v_created INTEGER := 0;
  v_joined INTEGER := 0;
  v_conflicts INTEGER := 0;
  v_conflict_dates TEXT[] := '{}';
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can enrol students' USING ERRCODE = '42501';
  END IF;

  -- ── validation ──
  IF jsonb_typeof(v_extras) <> 'array' THEN
    RAISE EXCEPTION 'The extra weekly lessons could not be read — please re-select the days and times';
  END IF;
  IF jsonb_array_length(v_extras) > 2 THEN
    RAISE EXCEPTION 'A class can be at most 3 times a week';
  END IF;
  v_slot_count := 1 + jsonb_array_length(v_extras);
  v_max_lessons := 60 * v_slot_count;

  IF NOT EXISTS (SELECT 1 FROM students WHERE id = p_student_id) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_teacher_id AND role = 'teacher') THEN
    RAISE EXCEPTION 'Please choose a teacher';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date <= p_start_date THEN
    RAISE EXCEPTION 'End date must be after the start date';
  END IF;
  IF p_total_lessons IS NULL OR p_total_lessons < 1 OR p_total_lessons > v_max_lessons THEN
    RAISE EXCEPTION 'Number of lessons must be between 1 and %', v_max_lessons;
  END IF;
  IF COALESCE(p_rate_per_lesson, -1) < 0 OR COALESCE(p_total_fee, -1) < 0
     OR COALESCE(p_registration_fee, 0) < 0 OR COALESCE(p_discount_value, 0) < 0 THEN
    RAISE EXCEPTION 'Fees and discounts cannot be negative';
  END IF;
  IF p_payment_plan <> 'trial' AND p_rate_per_lesson <= 0 THEN
    RAISE EXCEPTION 'Enter a lesson rate greater than ₹0 (or choose the Trial plan)';
  END IF;

  -- ── first weekly slot (unchanged behaviour) ──
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_tpl FROM teacher_schedule_templates WHERE id = p_template_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That schedule slot no longer exists';
    END IF;
    IF v_tpl.teacher_id <> p_teacher_id THEN
      RAISE EXCEPTION 'That slot belongs to a different teacher — pick a slot for the selected teacher';
    END IF;
    IF NOT (p_student_id = ANY(COALESCE(v_tpl.student_ids, '{}'))) THEN
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = p_template_id;
    END IF;
  ELSE
    IF p_day_of_week IS NULL OR p_day_of_week NOT BETWEEN 0 AND 6 OR p_start_time IS NULL THEN
      RAISE EXCEPTION 'Choose a day and start time for the new slot';
    END IF;
    IF p_end_time IS NOT NULL AND p_end_time <= p_start_time THEN
      RAISE EXCEPTION 'Slot end time must be after the start time';
    END IF;
    INSERT INTO teacher_schedule_templates
      (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids, is_active)
    VALUES
      (p_teacher_id, p_day_of_week, p_start_time, p_end_time, p_location_id, p_instrument_id,
       COALESCE(NULLIF(trim(p_title), ''), 'Lesson'), ARRAY[p_student_id], true)
    RETURNING * INTO v_tpl;
  END IF;

  v_tpl_ids  := ARRAY[v_tpl.id];
  v_joinable := ARRAY[p_template_id IS NOT NULL];
  v_days     := ARRAY[v_tpl.day_of_week::INTEGER];
  v_starts   := ARRAY[v_tpl.start_time];
  v_ends     := ARRAY[COALESCE(v_tpl.end_time, (v_tpl.start_time + INTERVAL '45 minutes')::TIME)];
  v_new_ends := ARRAY[v_tpl.end_time];

  -- ── extra weekly occurrences: read + validate all before creating anything ──
  FOR v_i IN 0 .. jsonb_array_length(v_extras) - 1 LOOP
    v_n := v_i + 2;  -- "weekly lesson 2", "weekly lesson 3"
    v_item := v_extras -> v_i;
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Weekly lesson %: choose a slot or a day and time', v_n;
    END IF;

    IF NULLIF(v_item ->> 'template_id', '') IS NOT NULL THEN
      BEGIN
        v_x_id := (v_item ->> 'template_id')::UUID;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot could not be found — please pick it again', v_n;
      END;
      SELECT * INTO v_x FROM teacher_schedule_templates WHERE id = v_x_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Weekly lesson %: that schedule slot no longer exists', v_n;
      END IF;
      IF v_x.teacher_id <> p_teacher_id THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot belongs to a different teacher — all weekly lessons of a class are with the same teacher', v_n;
      END IF;
      IF NOT v_x.is_active THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot is no longer active — pick another one', v_n;
      END IF;
      IF v_x.id = ANY(v_tpl_ids) THEN
        RAISE EXCEPTION 'The same weekly slot (% %) was chosen twice — pick a different day or time for weekly lesson %',
          c_days[v_x.day_of_week + 1], to_char(v_x.start_time, 'HH24:MI'), v_n;
      END IF;
      IF v_x.instrument_id IS NOT NULL AND COALESCE(v_tpl.instrument_id, p_instrument_id) IS NOT NULL
         AND v_x.instrument_id <> COALESCE(v_tpl.instrument_id, p_instrument_id) THEN
        RAISE EXCEPTION 'Weekly lesson %: that slot is for a different instrument — all weekly lessons of a class are the same instrument', v_n;
      END IF;
      v_tpl_ids  := v_tpl_ids || v_x.id;
      v_joinable := v_joinable || true;
      v_days     := v_days || v_x.day_of_week::INTEGER;
      v_starts   := v_starts || v_x.start_time;
      v_ends     := v_ends || COALESCE(v_x.end_time, (v_x.start_time + INTERVAL '45 minutes')::TIME);
      v_new_ends := v_new_ends || v_x.end_time;
    ELSE
      BEGIN
        v_x_day := (v_item ->> 'day_of_week')::INTEGER;
        v_x_start := NULLIF(v_item ->> 'start_time', '')::TIME;
        v_x_end := NULLIF(v_item ->> 'end_time', '')::TIME;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Weekly lesson %: the day or time is not valid', v_n;
      END;
      IF v_x_day IS NULL OR v_x_day NOT BETWEEN 0 AND 6 OR v_x_start IS NULL THEN
        RAISE EXCEPTION 'Weekly lesson %: choose a day and start time', v_n;
      END IF;
      IF v_x_end IS NOT NULL AND v_x_end <= v_x_start THEN
        RAISE EXCEPTION 'Weekly lesson %: end time must be after the start time', v_n;
      END IF;
      v_tpl_ids  := v_tpl_ids || NULL::UUID;
      v_joinable := v_joinable || false;
      v_days     := v_days || v_x_day;
      v_starts   := v_starts || v_x_start;
      v_ends     := v_ends || COALESCE(v_x_end, (v_x_start + INTERVAL '45 minutes')::TIME);
      v_new_ends := v_new_ends || v_x_end;
    END IF;
  END LOOP;

  -- No two weekly lessons of the class may overlap (same day, overlapping times).
  FOR v_i IN 1 .. v_slot_count LOOP
    FOR v_j IN v_i + 1 .. v_slot_count LOOP
      IF v_days[v_i] = v_days[v_j] AND v_starts[v_i] < v_ends[v_j] AND v_starts[v_j] < v_ends[v_i] THEN
        RAISE EXCEPTION 'Weekly lessons % and % overlap on % (% and %) — choose different days or times',
          v_i, v_j, c_days[v_days[v_i] + 1], to_char(v_starts[v_i], 'HH24:MI'), to_char(v_starts[v_j], 'HH24:MI');
      END IF;
    END LOOP;
  END LOOP;

  -- Create the new extra slots / put the student on the existing ones.
  FOR v_i IN 2 .. v_slot_count LOOP
    IF v_tpl_ids[v_i] IS NULL THEN
      INSERT INTO teacher_schedule_templates
        (teacher_id, day_of_week, start_time, end_time, location_id, instrument_id, title, student_ids,
         is_active, counts_toward_lessons)
      VALUES
        (p_teacher_id, v_days[v_i], v_starts[v_i], v_new_ends[v_i], COALESCE(v_tpl.location_id, p_location_id),
         COALESCE(v_tpl.instrument_id, p_instrument_id), COALESCE(NULLIF(v_tpl.title, ''), 'Lesson'),
         ARRAY[p_student_id], true, COALESCE(v_tpl.counts_toward_lessons, true))
      RETURNING id INTO v_x_id;
      v_tpl_ids[v_i] := v_x_id;
    ELSE
      UPDATE teacher_schedule_templates
        SET student_ids = array_append(COALESCE(student_ids, '{}'), p_student_id), updated_at = now()
        WHERE id = v_tpl_ids[v_i] AND NOT (p_student_id = ANY(COALESCE(student_ids, '{}')));
    END IF;
  END LOOP;

  v_location := COALESCE(v_tpl.location_id, p_location_id,
                         (SELECT location_id FROM students WHERE id = p_student_id));

  -- ── enrolment ──
  INSERT INTO student_enrolments (
    student_id, academic_year, lesson_rate_id, total_lessons, lessons_used, start_date,
    payment_plan, rate_per_lesson, total_fee, registration_fee, instrument_id,
    discount_primary, discount_multilesson, discount_value, template_id, extra_template_ids
  ) VALUES (
    p_student_id, COALESCE(NULLIF(p_academic_year, ''), to_char(p_start_date, 'YYYY')), p_lesson_rate_id,
    p_total_lessons, 0, p_start_date, p_payment_plan, p_rate_per_lesson, p_total_fee,
    COALESCE(p_registration_fee, 0), COALESCE(v_tpl.instrument_id, p_instrument_id),
    COALESCE(p_discount_primary, 'none'), COALESCE(p_discount_multilesson, false),
    CASE WHEN p_discount_primary = 'special' THEN COALESCE(p_discount_value, 0) ELSE 0 END,
    v_tpl.id,                         -- the class's first weekly slot
    v_tpl_ids[2:v_slot_count]         -- its 2nd/3rd weekly slots ('{}' at 1× per week)
  ) RETURNING id INTO v_enrolment_id;

  -- ── lessons: every weekly occurrence, in date order, until the total is reached ──
  FOR v_occ IN
    SELECT d::date AS lesson_date, o.joinable, o.ord,
           t.id AS tpl_id, t.start_time, t.end_time, t.title, t.instrument_id, t.location_id,
           t.counts_toward_lessons
    FROM unnest(v_tpl_ids, v_joinable) WITH ORDINALITY AS o(tpl_id, joinable, ord)
    JOIN teacher_schedule_templates t ON t.id = o.tpl_id
    JOIN generate_series(p_start_date, p_end_date, INTERVAL '1 day') AS d
      ON EXTRACT(DOW FROM d) = t.day_of_week
    ORDER BY d, t.start_time, o.ord
  LOOP
    EXIT WHEN v_created + v_joined >= p_total_lessons;
    v_end_time := COALESCE(v_occ.end_time, v_occ.start_time + INTERVAL '45 minutes');

    -- Same slot already has a lesson that day (e.g. a group class): join it.
    SELECT l.id, l.instrument_id INTO v_existing
    FROM lessons l
    WHERE l.teacher_id = p_teacher_id AND l.date = v_occ.lesson_date AND l.start_time = v_occ.start_time
      AND l.status <> 'cancelled'
    LIMIT 1;

    IF FOUND THEN
      -- Only join when the coordinator deliberately picked an existing slot;
      -- a NEW slot at an occupied time is a clash (never merge into someone's 1:1).
      IF v_occ.joinable AND v_existing.instrument_id IS NOT DISTINCT FROM v_occ.instrument_id THEN
        INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
        VALUES (v_existing.id, p_student_id, v_enrolment_id)
        ON CONFLICT (lesson_id, student_id) DO UPDATE SET enrolment_id = EXCLUDED.enrolment_id;
        v_joined := v_joined + 1;
      ELSE
        v_conflicts := v_conflicts + 1;
        v_conflict_dates := array_append(v_conflict_dates, v_occ.lesson_date::text);
      END IF;
      CONTINUE;
    END IF;

    -- Teacher busy with a different lesson overlapping this time: don't double-book.
    IF EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.teacher_id = p_teacher_id AND l.date = v_occ.lesson_date AND l.status <> 'cancelled'
        AND l.start_time < v_end_time
        AND COALESCE(l.end_time, l.start_time + INTERVAL '45 minutes') > v_occ.start_time
    ) THEN
      v_conflicts := v_conflicts + 1;
      v_conflict_dates := array_append(v_conflict_dates, v_occ.lesson_date::text);
      CONTINUE;
    END IF;

    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time, title,
                         template_id, is_charged)
    VALUES (p_teacher_id, COALESCE(v_occ.location_id, v_location), v_occ.instrument_id, 'regular',
            v_occ.lesson_date, v_occ.start_time, v_occ.end_time,
            COALESCE(NULLIF(v_occ.title, ''), 'Lesson'), v_occ.tpl_id, COALESCE(v_occ.counts_toward_lessons, true))
    RETURNING id INTO v_lesson_id;

    INSERT INTO lesson_students (lesson_id, student_id, enrolment_id)
    VALUES (v_lesson_id, p_student_id, v_enrolment_id);
    v_created := v_created + 1;
  END LOOP;

  -- ── instalments (one schedule for the whole class) ──
  PERFORM generate_instalments(v_enrolment_id);

  RETURN jsonb_build_object(
    'enrolment_id', v_enrolment_id,
    'template_id', v_tpl.id,
    'extra_template_ids', to_jsonb(v_tpl_ids[2:v_slot_count]),
    'slots', v_slot_count,
    'lessons_created', v_created,
    'lessons_joined', v_joined,
    'lessons_scheduled', v_created + v_joined,
    'lessons_expected', p_total_lessons,
    'conflicts', v_conflicts,
    'conflict_dates', to_jsonb(v_conflict_dates)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.enrol_student(UUID, UUID, payment_plan, DATE, DATE, INTEGER, NUMERIC, NUMERIC, NUMERIC, UUID, TEXT, TEXT, BOOLEAN, NUMERIC, UUID, INTEGER, TIME, TIME, UUID, TEXT, UUID, JSONB) TO authenticated;


-- c. delete_enrolment -------------------------------------------------------
-- As §13, plus: the class's own weekly slots (first + extra) are released
-- even when the student has another enrolment for the same instrument —
-- unless another enrolment of theirs uses that slot (or one with an unknown
-- slot could be using it).
CREATE OR REPLACE FUNCTION public.delete_enrolment(p_enrolment_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enr student_enrolments%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_unpaid INTEGER;
  v_lessons INTEGER;
  v_lesson_ids UUID[];
  v_slots UUID[];
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can delete enrolments' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_enr FROM student_enrolments WHERE id = p_enrolment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found';
  END IF;

  DELETE FROM payment_records WHERE enrolment_id = p_enrolment_id AND paid_date IS NULL;
  GET DIAGNOSTICS v_unpaid = ROW_COUNT;

  -- Unlink the student from this enrolment's future, not-yet-held lessons
  -- (every weekly slot of the class), then delete those lessons if nobody
  -- else is in them.
  WITH removed AS (
    DELETE FROM lesson_students ls
    USING lessons l
    WHERE ls.lesson_id = l.id AND ls.enrolment_id = p_enrolment_id
      AND l.date >= v_today AND l.status = 'scheduled'
    RETURNING ls.lesson_id
  )
  SELECT COALESCE(array_agg(lesson_id), '{}') INTO v_lesson_ids FROM removed;
  v_lessons := COALESCE(array_length(v_lesson_ids, 1), 0);

  DELETE FROM lessons l
  WHERE l.id = ANY(v_lesson_ids)
    AND NOT EXISTS (SELECT 1 FROM lesson_students ls WHERE ls.lesson_id = l.id);

  -- Take the student off weekly slots for this instrument.
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, v_enr.student_id), updated_at = now()
    WHERE v_enr.student_id = ANY(student_ids)
      AND instrument_id IS NOT DISTINCT FROM v_enr.instrument_id
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                       WHERE o.student_id = v_enr.student_id AND o.id <> v_enr.id
                         AND o.instrument_id IS NOT DISTINCT FROM v_enr.instrument_id);

  -- … and off this class's own weekly slots (incl. its 2nd/3rd weekly lesson).
  v_slots := array_remove(ARRAY[v_enr.template_id] || COALESCE(v_enr.extra_template_ids, '{}'), NULL);
  UPDATE teacher_schedule_templates t
    SET student_ids = array_remove(t.student_ids, v_enr.student_id), updated_at = now()
    WHERE t.id = ANY(v_slots)
      AND v_enr.student_id = ANY(COALESCE(t.student_ids, '{}'))
      AND NOT EXISTS (SELECT 1 FROM student_enrolments o
                       WHERE o.student_id = v_enr.student_id AND o.id <> v_enr.id
                         AND (o.template_id = t.id
                              OR t.id = ANY(COALESCE(o.extra_template_ids, '{}'))
                              OR (o.template_id IS NULL
                                  AND o.instrument_id IS NOT DISTINCT FROM v_enr.instrument_id)));

  DELETE FROM student_enrolments WHERE id = p_enrolment_id;

  RETURN jsonb_build_object('unpaid_instalments_removed', v_unpaid, 'future_lessons_removed', v_lessons);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_enrolment(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_enrolment(UUID) TO authenticated;


-- d. rollover_release_slot --------------------------------------------------
-- As before; "renewed on that slot" now also counts a 2nd/3rd weekly slot.
-- (The renewal screen calls it for each weekly slot of a dropped class.)
CREATE OR REPLACE FUNCTION public.rollover_release_slot(p_student_id UUID, p_template_id UUID, p_to_year TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM student_enrolments
             WHERE student_id = p_student_id
               AND (template_id = p_template_id OR p_template_id = ANY(COALESCE(extra_template_ids, '{}')))
               AND academic_year >= p_to_year) THEN
    RETURN false;
  END IF;
  UPDATE teacher_schedule_templates
    SET student_ids = array_remove(student_ids, p_student_id), updated_at = now()
    WHERE id = p_template_id AND p_student_id = ANY(COALESCE(student_ids, '{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.rollover_release_slot(UUID, UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rollover_release_slot(UUID, UUID, TEXT) TO authenticated;


-- e. renewal_candidates -----------------------------------------------------
-- As before, plus per class: 'extra_slots' (the 2nd/3rd weekly slots, same
-- shape as 'slot', in order) and 'times_per_week'; per renewed enrolment:
-- 'extra_template_ids'.
CREATE OR REPLACE FUNCTION public.renewal_candidates(p_from_year TEXT, p_to_year TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF jwt_role() IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Only coordinators can renew enrolments' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_from_year), '') = '' OR COALESCE(trim(p_to_year), '') = '' THEN
    RAISE EXCEPTION 'Choose the year to renew from and to';
  END IF;
  IF p_to_year <= p_from_year THEN
    RAISE EXCEPTION 'The new year must be after the year you renew from';
  END IF;

  WITH cls AS (
    SELECT se.*,
           -- teacher: the slot's, else whoever taught most of this enrolment's lessons
           COALESCE(t.teacher_id, (
             SELECT l.teacher_id FROM lesson_students ls JOIN lessons l ON l.id = ls.lesson_id
             WHERE ls.enrolment_id = se.id
             GROUP BY l.teacher_id ORDER BY count(*) DESC, l.teacher_id LIMIT 1)) AS cls_teacher_id,
           t.id AS t_id, t.day_of_week, t.start_time, t.end_time, t.is_active AS t_active,
           t.is_group, t.title AS t_title, t.instrument_id AS t_instrument_id, t.teacher_id AS t_teacher_id,
           (se.student_id = ANY(COALESCE(t.student_ids, '{}'))) AS t_on_slot,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'id', x.id, 'teacher_id', x.teacher_id, 'day_of_week', x.day_of_week,
                      'start_time', x.start_time, 'end_time', x.end_time, 'is_active', x.is_active,
                      'is_group', x.is_group, 'title', x.title, 'instrument_id', x.instrument_id,
                      'student_on_slot', se.student_id = ANY(COALESCE(x.student_ids, '{}'))) ORDER BY u.ord)
             FROM unnest(COALESCE(se.extra_template_ids, '{}')) WITH ORDINALITY AS u(tid, ord)
             JOIN teacher_schedule_templates x ON x.id = u.tid), '[]'::jsonb) AS x_slots
    FROM student_enrolments se
    JOIN students s ON s.id = se.student_id AND s.is_active
    LEFT JOIN teacher_schedule_templates t ON t.id = se.template_id
    WHERE se.academic_year = p_from_year
  ),
  per_student AS (
    SELECT c.student_id,
           jsonb_agg(jsonb_build_object(
             'enrolment_id', c.id,
             'instrument_id', c.instrument_id,
             'instrument_name', i.name,
             'template_id', c.template_id,
             'teacher_id', c.cls_teacher_id,
             'teacher_name', p.full_name,
             'slot', CASE WHEN c.t_id IS NULL THEN NULL ELSE jsonb_build_object(
                        'id', c.t_id, 'teacher_id', c.t_teacher_id, 'day_of_week', c.day_of_week,
                        'start_time', c.start_time, 'end_time', c.end_time, 'is_active', c.t_active,
                        'is_group', c.is_group, 'title', c.t_title, 'instrument_id', c.t_instrument_id,
                        'student_on_slot', c.t_on_slot) END,
             'extra_slots', c.x_slots,
             'times_per_week', 1 + jsonb_array_length(c.x_slots),
             'rate_per_lesson', c.rate_per_lesson,
             'payment_plan', c.payment_plan,
             'lesson_rate_id', c.lesson_rate_id,
             'discount_primary', c.discount_primary,
             'discount_multilesson', c.discount_multilesson,
             'discount_value', c.discount_value,
             'total_lessons', c.total_lessons,
             'total_fee', c.total_fee,
             'start_date', c.start_date
           ) ORDER BY i.name NULLS LAST, c.created_at, c.id) AS classes
    FROM cls c
    LEFT JOIN instruments i ON i.id = c.instrument_id
    LEFT JOIN profiles p ON p.id = c.cls_teacher_id
    GROUP BY c.student_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'student_id', s.id,
           'full_name', s.full_name,
           'location_id', s.location_id,
           'classes', ps.classes,
           'renewed', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
                      'enrolment_id', n.id, 'instrument_id', n.instrument_id, 'instrument_name', ni.name,
                      'template_id', n.template_id, 'extra_template_ids', to_jsonb(COALESCE(n.extra_template_ids, '{}')),
                      'rate_per_lesson', n.rate_per_lesson,
                      'payment_plan', n.payment_plan, 'total_fee', n.total_fee) ORDER BY n.created_at, n.id)
             FROM student_enrolments n LEFT JOIN instruments ni ON ni.id = n.instrument_id
             WHERE n.student_id = s.id AND n.academic_year = p_to_year), '[]'::jsonb)
         ) ORDER BY s.full_name, s.id), '[]'::jsonb)
  INTO v_result
  FROM per_student ps
  JOIN students s ON s.id = ps.student_id;

  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.renewal_candidates(TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.renewal_candidates(TEXT, TEXT) TO authenticated;

-- PostgREST: pick up the new enrol_student signature.
NOTIFY pgrst, 'reload schema';
