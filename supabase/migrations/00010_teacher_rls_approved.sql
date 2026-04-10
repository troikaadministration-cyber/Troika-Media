-- Require approved=true for teacher RLS policies
-- Prevents pending teachers from accessing lesson and curriculum data

CREATE OR REPLACE FUNCTION is_approved_teacher()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'teacher' AND approved = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Lessons
DROP POLICY IF EXISTS "Teachers see own lessons" ON lessons;
CREATE POLICY "Teachers see own lessons" ON lessons
  FOR SELECT USING (teacher_id = auth.uid() AND is_approved_teacher());

DROP POLICY IF EXISTS "Teachers update own lessons" ON lessons;
CREATE POLICY "Teachers update own lessons" ON lessons
  FOR UPDATE USING (teacher_id = auth.uid() AND is_approved_teacher());

-- Lesson students
DROP POLICY IF EXISTS "Teachers see own lesson students" ON lesson_students;
CREATE POLICY "Teachers see own lesson students" ON lesson_students
  FOR SELECT USING (
    is_approved_teacher() AND
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers insert own lesson students" ON lesson_students;
CREATE POLICY "Teachers insert own lesson students" ON lesson_students
  FOR INSERT WITH CHECK (
    is_approved_teacher() AND
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

DROP POLICY IF EXISTS "Teachers update own lesson students" ON lesson_students;
CREATE POLICY "Teachers update own lesson students" ON lesson_students
  FOR UPDATE USING (
    is_approved_teacher() AND
    lesson_id IN (SELECT id FROM lessons WHERE teacher_id = auth.uid())
  );

-- Student pieces
DROP POLICY IF EXISTS "Teachers manage own student pieces" ON student_pieces;
CREATE POLICY "Teachers manage own student pieces" ON student_pieces
  FOR ALL USING (teacher_id = auth.uid() AND is_approved_teacher());

-- Media uploads
DROP POLICY IF EXISTS "Teachers manage own media" ON media_uploads;
CREATE POLICY "Teachers manage own media" ON media_uploads
  FOR ALL USING (teacher_id = auth.uid() AND is_approved_teacher());

-- Curriculum (previously any teacher could write; now requires approved)
DROP POLICY IF EXISTS "Teachers manage resources" ON curriculum_resources;
CREATE POLICY "Teachers manage resources" ON curriculum_resources
  FOR ALL USING (is_approved_teacher());

DROP POLICY IF EXISTS "Teachers manage tags" ON curriculum_tags;
CREATE POLICY "Teachers manage tags" ON curriculum_tags
  FOR ALL USING (is_approved_teacher());

DROP POLICY IF EXISTS "Teachers manage resource tags" ON curriculum_resource_tags;
CREATE POLICY "Teachers manage resource tags" ON curriculum_resource_tags
  FOR ALL USING (is_approved_teacher());

-- Profiles: pending teachers cannot view other teacher profiles
DROP POLICY IF EXISTS "Teachers can view teacher profiles" ON profiles;
CREATE POLICY "Teachers can view teacher profiles" ON profiles
  FOR SELECT USING (
    is_approved_teacher() AND role = 'teacher'
  );
