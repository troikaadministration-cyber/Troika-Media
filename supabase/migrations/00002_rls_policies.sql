-- Row Level Security Policies (full rewrite)

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_resource_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to get student_id for current user
CREATE OR REPLACE FUNCTION get_student_id()
RETURNS UUID AS $$
  SELECT id FROM students WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PROFILES
-- ============================================================
-- All users can see own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (id = auth.uid());

-- Coordinators can view all profiles
CREATE POLICY "Coordinators can view all profiles" ON profiles
  FOR SELECT USING (get_user_role() = 'coordinator');

-- Teachers can view all teacher profiles (needed for schedule dropdowns)
CREATE POLICY "Teachers can view teacher profiles" ON profiles
  FOR SELECT USING (
    get_user_role() = 'teacher' AND role = 'teacher'
  );

-- Users can update own profile, but cannot change their own role
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (role = (SELECT role FROM profiles WHERE id = auth.uid()));

-- Coordinators can manage all profiles (including role changes)
CREATE POLICY "Coordinators manage all profiles" ON profiles
  FOR ALL USING (get_user_role() = 'coordinator');

-- ============================================================
-- LOCATIONS (everyone reads, coordinators write)
-- ============================================================
CREATE POLICY "Anyone can view locations" ON locations
  FOR SELECT USING (true);
CREATE POLICY "Coordinators manage locations" ON locations
  FOR ALL USING (get_user_role() = 'coordinator');

-- ============================================================
-- INSTRUMENTS (everyone reads, coordinators write)
-- ============================================================
CREATE POLICY "Anyone can view instruments" ON instruments
  FOR SELECT USING (true);
CREATE POLICY "Coordinators manage instruments" ON instruments
  FOR ALL USING (get_user_role() = 'coordinator');

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE POLICY "Teachers see their lesson students" ON students
  FOR SELECT USING (
    get_user_role() = 'teacher' AND id IN (
      SELECT ls.student_id FROM lesson_students ls
      JOIN lessons l ON l.id = ls.lesson_id
      WHERE l.teacher_id = auth.uid()
    )
  );
CREATE POLICY "Students see own record" ON students
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Coordinators manage students" ON students
  FOR ALL USING (get_user_role() = 'coordinator');

-- ============================================================
-- LESSONS
-- ============================================================
CREATE POLICY "Teachers see own lessons" ON lessons
  FOR SELECT USING (teacher_id = auth.uid());
CREATE POLICY "Teachers update own lessons" ON lessons
  FOR UPDATE USING (teacher_id = auth.uid());
CREATE POLICY "Coordinators manage all lessons" ON lessons
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Students see enrolled lessons" ON lessons
  FOR SELECT USING (
    get_user_role() = 'student' AND id IN (
      SELECT lesson_id FROM lesson_students
      WHERE student_id = get_student_id()
    )
  );

-- ============================================================
-- LESSON_STUDENTS
-- ============================================================
CREATE POLICY "Teachers see own lesson students" ON lesson_students
  FOR SELECT USING (
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );
-- Teachers can INSERT and UPDATE attendance for their own lessons
CREATE POLICY "Teachers insert own lesson students" ON lesson_students
  FOR INSERT WITH CHECK (
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Teachers update own lesson students" ON lesson_students
  FOR UPDATE USING (
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );
CREATE POLICY "Coordinators manage lesson students" ON lesson_students
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Students see own enrollments" ON lesson_students
  FOR SELECT USING (student_id = get_student_id());

-- ============================================================
-- STUDENT_PIECES
-- ============================================================
CREATE POLICY "Teachers manage own student pieces" ON student_pieces
  FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "Coordinators manage all pieces" ON student_pieces
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Students see own pieces" ON student_pieces
  FOR SELECT USING (student_id = get_student_id());

-- ============================================================
-- MEDIA_UPLOADS
-- ============================================================
CREATE POLICY "Teachers manage own media" ON media_uploads
  FOR ALL USING (teacher_id = auth.uid());
CREATE POLICY "Coordinators manage all media" ON media_uploads
  FOR ALL USING (get_user_role() = 'coordinator');

-- ============================================================
-- CURRICULUM (everyone reads, coordinators + teachers write)
-- ============================================================
CREATE POLICY "Anyone can view resources" ON curriculum_resources
  FOR SELECT USING (true);
CREATE POLICY "Coordinators manage resources" ON curriculum_resources
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Teachers manage resources" ON curriculum_resources
  FOR ALL USING (get_user_role() = 'teacher');

CREATE POLICY "Anyone can view tags" ON curriculum_tags
  FOR SELECT USING (true);
CREATE POLICY "Coordinators manage tags" ON curriculum_tags
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Teachers manage tags" ON curriculum_tags
  FOR ALL USING (get_user_role() = 'teacher');

CREATE POLICY "Anyone can view resource tags" ON curriculum_resource_tags
  FOR SELECT USING (true);
CREATE POLICY "Coordinators manage resource tags" ON curriculum_resource_tags
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Teachers manage resource tags" ON curriculum_resource_tags
  FOR ALL USING (get_user_role() = 'teacher');

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE POLICY "Users see own notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users update own notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users delete own notifications" ON notifications
  FOR DELETE USING (user_id = auth.uid());
-- Coordinators or own user can insert notifications
CREATE POLICY "Insert own or coordinator notifications" ON notifications
  FOR INSERT WITH CHECK (
    user_id = auth.uid() OR get_user_role() = 'coordinator'
  );

-- ============================================================
-- PAYMENT_RECORDS
-- ============================================================
CREATE POLICY "Coordinators manage payments" ON payment_records
  FOR ALL USING (get_user_role() = 'coordinator');
CREATE POLICY "Students see own payments" ON payment_records
  FOR SELECT USING (student_id = get_student_id());
