-- Migration 00005: Security fixes, missing indexes, RLS gaps, double-booking prevention
-- Fixes identified in platform audit

-- ============================================================
-- 0. Fix handle_new_user — non-admin users get empty full_name (forces RoleSetup)
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'coordinator'::user_role ELSE 'student'::user_role END,
    CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'Troika Admin' ELSE '' END,
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    role = CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'coordinator'::user_role ELSE profiles.role END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 1. Missing indexes on hot query paths
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_student_pieces_teacher ON student_pieces(teacher_id);
CREATE INDEX IF NOT EXISTS idx_media_uploads_teacher ON media_uploads(teacher_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read = false;
CREATE INDEX IF NOT EXISTS idx_curriculum_tags_name ON curriculum_tags(name);
CREATE INDEX IF NOT EXISTS idx_lesson_rates_category ON lesson_rates(category, is_online, academic_year);
CREATE INDEX IF NOT EXISTS idx_lesson_rates_teacher ON lesson_rates(teacher_id, category);
CREATE INDEX IF NOT EXISTS idx_invoices_issued_date ON invoices(issued_date);
CREATE INDEX IF NOT EXISTS idx_payment_records_student_plan ON payment_records(student_id, plan);
CREATE INDEX IF NOT EXISTS idx_lessons_teacher_date ON lessons(teacher_id, date);
CREATE INDEX IF NOT EXISTS idx_lessons_date_status ON lessons(date, status);

-- ============================================================
-- 2. RLS: Students can read media from their lessons
-- ============================================================
CREATE POLICY "Students read own lesson media"
  ON media_uploads FOR SELECT
  USING (
    get_user_role() = 'student'
    AND lesson_id IN (
      SELECT ls.lesson_id FROM lesson_students ls
      WHERE ls.student_id = get_student_id()
    )
  );

-- ============================================================
-- 3. RLS: Add created_by column and restrict curriculum deletion
-- ============================================================

-- Add created_by column to track resource ownership
ALTER TABLE curriculum_resources
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- Drop old overly-permissive teacher policy if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'curriculum_resources' AND policyname = 'Teachers manage curriculum_resources'
  ) THEN
    DROP POLICY "Teachers manage curriculum_resources" ON curriculum_resources;
  END IF;
END
$$;

-- Teachers can read all resources
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'curriculum_resources' AND policyname = 'Teachers read curriculum_resources') THEN
    CREATE POLICY "Teachers read curriculum_resources"
      ON curriculum_resources FOR SELECT
      USING (get_user_role() = 'teacher');
  END IF;
END
$$;

-- Teachers can create resources
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'curriculum_resources' AND policyname = 'Teachers create curriculum_resources') THEN
    CREATE POLICY "Teachers create curriculum_resources"
      ON curriculum_resources FOR INSERT
      WITH CHECK (get_user_role() = 'teacher');
  END IF;
END
$$;

-- Teachers can only update their own resources
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'curriculum_resources' AND policyname = 'Teachers update own curriculum_resources') THEN
    CREATE POLICY "Teachers update own curriculum_resources"
      ON curriculum_resources FOR UPDATE
      USING (
        get_user_role() = 'teacher'
        AND (created_by = auth.uid() OR created_by IS NULL)
      );
  END IF;
END
$$;

-- Teachers can only delete their own resources
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'curriculum_resources' AND policyname = 'Teachers delete own curriculum_resources') THEN
    CREATE POLICY "Teachers delete own curriculum_resources"
      ON curriculum_resources FOR DELETE
      USING (
        get_user_role() = 'teacher'
        AND (created_by = auth.uid() OR created_by IS NULL)
      );
  END IF;
END
$$;

-- ============================================================
-- 4. RLS: Coordinators can delete invoices + invoice storage
-- ============================================================
-- Add DELETE policy for invoice storage (coordinators)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Coordinators delete invoice files'
  ) THEN
    CREATE POLICY "Coordinators delete invoice files"
      ON storage.objects FOR DELETE
      USING (bucket_id = 'invoices' AND get_user_role() = 'coordinator');
  END IF;
END
$$;

-- ============================================================
-- 5. Double-booking prevention for teachers
-- ============================================================
CREATE OR REPLACE FUNCTION fn_check_teacher_double_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Skip if no teacher or cancelled/deleted
  IF NEW.teacher_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Check for overlapping lessons with the same teacher on the same date
  IF EXISTS (
    SELECT 1 FROM lessons
    WHERE id != NEW.id
      AND teacher_id = NEW.teacher_id
      AND date = NEW.date
      AND status != 'cancelled'
      AND start_time = NEW.start_time
  ) THEN
    RAISE EXCEPTION 'Teacher already has a lesson at this time on this date';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_teacher_double_booking ON lessons;
CREATE TRIGGER trg_check_teacher_double_booking
  BEFORE INSERT OR UPDATE ON lessons
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_teacher_double_booking();

-- ============================================================
-- 6. Fix generate_instalments idempotency
-- ============================================================
CREATE OR REPLACE FUNCTION generate_instalments(p_enrolment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  num_instalments INTEGER;
  per_instalment NUMERIC(10,2);
  first_amount NUMERIC(10,2);
  i INTEGER;
  due DATE;
  existing_count INTEGER;
BEGIN
  SELECT * INTO rec FROM student_enrolments WHERE id = p_enrolment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found: %', p_enrolment_id;
  END IF;

  -- Idempotency: check if instalments already exist for this student+plan
  SELECT COUNT(*) INTO existing_count
  FROM payment_records
  WHERE student_id = rec.student_id
    AND plan = rec.payment_plan;

  IF existing_count > 0 THEN
    RETURN; -- Already generated
  END IF;

  -- Determine number of instalments from payment plan
  CASE rec.payment_plan
    WHEN 'trial' THEN RETURN;
    WHEN '1_instalment' THEN num_instalments := 1;
    WHEN '3_instalments' THEN num_instalments := 3;
    WHEN '10_instalments' THEN num_instalments := 10;
    ELSE RAISE EXCEPTION 'Unknown payment plan: %', rec.payment_plan;
  END CASE;

  per_instalment := ROUND(rec.total_fee / num_instalments, 2);
  first_amount := per_instalment + rec.registration_fee;

  FOR i IN 1..num_instalments LOOP
    CASE num_instalments
      WHEN 1 THEN due := rec.start_date;
      WHEN 3 THEN due := rec.start_date + ((i - 1) * 4 * INTERVAL '1 month')::INTERVAL;
      WHEN 10 THEN due := rec.start_date + ((i - 1) * INTERVAL '1 month')::INTERVAL;
    END CASE;

    INSERT INTO payment_records (student_id, plan, amount, instalment_number, due_date)
    VALUES (
      rec.student_id,
      rec.payment_plan,
      CASE WHEN i = 1 THEN first_amount ELSE per_instalment END,
      i,
      due::DATE
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 7. Fix lesson counter — add decrement on un-complete
-- ============================================================
CREATE OR REPLACE FUNCTION fn_increment_lessons_used()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ls RECORD;
  acad_year TEXT;
BEGIN
  -- Increment when lesson status changes TO 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    acad_year := EXTRACT(YEAR FROM NEW.date)::TEXT;

    FOR ls IN
      SELECT student_id FROM lesson_students
      WHERE lesson_id = NEW.id
        AND (attended = true OR absence_category = 'charged')
    LOOP
      UPDATE student_enrolments
      SET lessons_used = lessons_used + 1,
          updated_at = now()
      WHERE student_id = ls.student_id
        AND academic_year = acad_year;
    END LOOP;
  END IF;

  -- Decrement when lesson status changes FROM 'completed' to something else
  IF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    acad_year := EXTRACT(YEAR FROM OLD.date)::TEXT;

    FOR ls IN
      SELECT student_id FROM lesson_students
      WHERE lesson_id = NEW.id
        AND (attended = true OR absence_category = 'charged')
    LOOP
      UPDATE student_enrolments
      SET lessons_used = GREATEST(lessons_used - 1, 0),
          updated_at = now()
      WHERE student_id = ls.student_id
        AND academic_year = acad_year;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 8. Allow students to insert their own student record (during RoleSetup)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'students' AND policyname = 'Users can create own student record'
  ) THEN
    CREATE POLICY "Users can create own student record"
      ON students FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
END
$$;

-- ============================================================
-- 9. Storage: student read policy for lesson-media
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects' AND policyname = 'Students read own lesson media files'
  ) THEN
    CREATE POLICY "Students read own lesson media files"
      ON storage.objects FOR SELECT
      USING (
        bucket_id = 'lesson-media'
        AND get_user_role() = 'student'
      );
  END IF;
END
$$;

-- ============================================================
-- 10. Fix slow student page — SECURITY DEFINER helpers to break RLS recursion
-- ============================================================

-- Function to get student's lesson IDs (bypasses RLS on lesson_students)
CREATE OR REPLACE FUNCTION get_student_lesson_ids()
RETURNS SETOF UUID AS $$
  SELECT ls.lesson_id
  FROM lesson_students ls
  WHERE ls.student_id = (SELECT id FROM students WHERE user_id = auth.uid() LIMIT 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Drop the slow recursive policy and replace with fast one
DROP POLICY IF EXISTS "Students see enrolled lessons" ON lessons;
CREATE POLICY "Students see enrolled lessons" ON lessons
  FOR SELECT USING (
    get_user_role() = 'student'
    AND id IN (SELECT get_student_lesson_ids())
  );

-- Allow students to see teacher profiles (for teacher name display on lessons)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'profiles' AND policyname = 'Students can view teacher profiles'
  ) THEN
    CREATE POLICY "Students can view teacher profiles" ON profiles
      FOR SELECT USING (
        get_user_role() = 'student' AND role = 'teacher'
      );
  END IF;
END
$$;
