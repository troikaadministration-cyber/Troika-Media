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
    'outstanding',     (SELECT COALESCE(sum(amount), 0) FROM payment_records WHERE paid_date IS NULL),
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
                          WHERE pr.paid_date IS NULL
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
      IF v_existing.instrument_id IS NOT DISTINCT FROM v_tpl.instrument_id THEN
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

    INSERT INTO lessons (teacher_id, location_id, instrument_id, lesson_type, date, start_time, end_time, title)
    VALUES (p_teacher_id, v_location, v_tpl.instrument_id, 'regular', v_date, v_tpl.start_time, v_tpl.end_time,
            COALESCE(NULLIF(v_tpl.title, ''), 'Lesson'))
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
  IF FOUND AND (v_profile.role = 'coordinator' OR COALESCE(trim(v_profile.full_name), '') <> '') THEN
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
