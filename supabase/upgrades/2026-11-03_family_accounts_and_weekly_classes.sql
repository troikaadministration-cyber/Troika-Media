-- ============================================================================
-- Troika — UPGRADE: family accounts + classes 2×/3× per week (3 Nov 2026)
--
-- For a database installed with supabase/schema.sql BEFORE this date.
-- Paste this whole file into Supabase → SQL Editor → Run. Takes a few seconds.
-- Keeps all data. Safe to run more than once. Runs as one transaction:
-- either everything applies or nothing does.
--
-- (A brand-new install doesn't need this — schema.sql already includes it.)
-- ============================================================================

BEGIN;

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

COMMIT;

-- Tell the API about the new/changed functions.
NOTIFY pgrst, 'reload schema';
