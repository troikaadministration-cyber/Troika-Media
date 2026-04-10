-- Migration 00013: Add JWT role guards to expensive RLS policies
--
-- Problem: PostgreSQL evaluates ALL policies (combined with OR) for every row.
-- Expensive subqueries in teacher/student policies run even for coordinators.
-- Fix: Add a cheap role check as the first AND condition so the executor
-- short-circuits before hitting the expensive subquery.
--
-- COALESCE(auth.jwt()->'user_role', get_user_role()::text) ensures:
--   - If JWT has role (hook enabled): instant, no DB call
--   - If JWT missing role (hook not enabled): falls back to DB safely

-- Helper: cheap role check that prefers JWT
CREATE OR REPLACE FUNCTION jwt_role()
RETURNS text AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'user_role',
    (SELECT role::text FROM profiles WHERE id = auth.uid())
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- STUDENTS: teacher policy has expensive JOIN subquery
-- ============================================================
DROP POLICY IF EXISTS "Teachers see their lesson students" ON students;
CREATE POLICY "Teachers see their lesson students" ON students
  FOR SELECT USING (
    jwt_role() = 'teacher'
    AND id IN (
      SELECT ls.student_id FROM lesson_students ls
      JOIN lessons l ON l.id = ls.lesson_id
      WHERE l.teacher_id = auth.uid()
    )
  );

-- ============================================================
-- LESSONS: student policy has subquery via get_student_lesson_ids()
-- ============================================================
DROP POLICY IF EXISTS "Students see enrolled lessons" ON lessons;
CREATE POLICY "Students see enrolled lessons" ON lessons
  FOR SELECT USING (
    jwt_role() = 'student'
    AND id IN (SELECT get_student_lesson_ids())
  );

-- ============================================================
-- LESSON_STUDENTS: teacher policies have subqueries on lessons table
-- ============================================================
DROP POLICY IF EXISTS "Teachers see own lesson students" ON lesson_students;
CREATE POLICY "Teachers see own lesson students" ON lesson_students
  FOR SELECT USING (
    jwt_role() = 'teacher'
    AND is_approved_teacher()
    AND lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers insert own lesson students" ON lesson_students;
CREATE POLICY "Teachers insert own lesson students" ON lesson_students
  FOR INSERT WITH CHECK (
    jwt_role() = 'teacher'
    AND is_approved_teacher()
    AND lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers update own lesson students" ON lesson_students;
CREATE POLICY "Teachers update own lesson students" ON lesson_students
  FOR UPDATE USING (
    jwt_role() = 'teacher'
    AND is_approved_teacher()
    AND lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

-- Student policy on lesson_students
DROP POLICY IF EXISTS "Students see own enrollments" ON lesson_students;
CREATE POLICY "Students see own enrollments" ON lesson_students
  FOR SELECT USING (
    jwt_role() = 'student'
    AND student_id = get_student_id()
  );

-- ============================================================
-- MEDIA_UPLOADS: student policy has subquery
-- ============================================================
DROP POLICY IF EXISTS "Students read own lesson media" ON media_uploads;
CREATE POLICY "Students read own lesson media" ON media_uploads
  FOR SELECT USING (
    jwt_role() = 'student'
    AND lesson_id IN (
      SELECT ls.lesson_id FROM lesson_students ls
      WHERE ls.student_id = get_student_id()
    )
  );

-- ============================================================
-- PROFILES: avoid get_user_role() calls where possible
-- ============================================================
DROP POLICY IF EXISTS "Coordinators can view all profiles" ON profiles;
CREATE POLICY "Coordinators can view all profiles" ON profiles
  FOR SELECT USING (jwt_role() = 'coordinator');

DROP POLICY IF EXISTS "Coordinators manage all profiles" ON profiles;
CREATE POLICY "Coordinators manage all profiles" ON profiles
  FOR ALL USING (jwt_role() = 'coordinator');

-- ============================================================
-- LESSONS: coordinator policy
-- ============================================================
DROP POLICY IF EXISTS "Coordinators manage all lessons" ON lessons;
CREATE POLICY "Coordinators manage all lessons" ON lessons
  FOR ALL USING (jwt_role() = 'coordinator');

-- ============================================================
-- LESSON_STUDENTS: coordinator policy
-- ============================================================
DROP POLICY IF EXISTS "Coordinators manage lesson students" ON lesson_students;
CREATE POLICY "Coordinators manage lesson students" ON lesson_students
  FOR ALL USING (jwt_role() = 'coordinator');

-- ============================================================
-- STUDENTS: coordinator policy
-- ============================================================
DROP POLICY IF EXISTS "Coordinators manage students" ON students;
CREATE POLICY "Coordinators manage students" ON students
  FOR ALL USING (jwt_role() = 'coordinator');

-- ============================================================
-- PAYMENT_RECORDS
-- ============================================================
DROP POLICY IF EXISTS "Coordinators manage payments" ON payment_records;
CREATE POLICY "Coordinators manage payments" ON payment_records
  FOR ALL USING (jwt_role() = 'coordinator');

DROP POLICY IF EXISTS "Students see own payments" ON payment_records;
CREATE POLICY "Students see own payments" ON payment_records
  FOR SELECT USING (
    jwt_role() = 'student'
    AND student_id = get_student_id()
  );

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
DROP POLICY IF EXISTS "Insert own or coordinator notifications" ON notifications;
CREATE POLICY "Insert own or coordinator notifications" ON notifications
  FOR INSERT WITH CHECK (
    user_id = auth.uid() OR jwt_role() = 'coordinator'
  );
