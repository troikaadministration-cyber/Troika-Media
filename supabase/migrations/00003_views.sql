-- Student stats aggregation view (security_invoker respects RLS of calling user)
CREATE OR REPLACE VIEW student_stats
WITH (security_invoker = true) AS
SELECT
  s.id AS student_id,
  s.full_name AS student_name,
  COUNT(DISTINCT ls.lesson_id) FILTER (WHERE l.status = 'completed') AS total_lessons,
  COUNT(DISTINCT ls.lesson_id) FILTER (WHERE l.status = 'completed' AND l.lesson_type = 'regular') AS regular_lessons,
  COUNT(DISTINCT ls.lesson_id) FILTER (WHERE l.status = 'completed' AND l.lesson_type = 'makeup') AS makeup_lessons,
  COUNT(DISTINCT ls.lesson_id) FILTER (WHERE l.status = 'completed' AND l.lesson_type = 'special') AS special_lessons,
  COUNT(DISTINCT ls.id) FILTER (WHERE ls.attended = false AND ls.absence_category = 'charged') AS charged_absences,
  COUNT(DISTINCT ls.id) FILTER (WHERE ls.attended = false AND ls.absence_category = 'not_charged') AS not_charged_absences
FROM students s
LEFT JOIN lesson_students ls ON ls.student_id = s.id
LEFT JOIN lessons l ON l.id = ls.lesson_id
GROUP BY s.id, s.full_name;

-- Supabase storage bucket for media
INSERT INTO storage.buckets (id, name, public) VALUES ('lesson-media', 'lesson-media', false)
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Teachers upload media" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'lesson-media' AND
    (SELECT role FROM profiles WHERE id = auth.uid()) IN ('teacher', 'coordinator') AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Teachers view own media" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'lesson-media' AND
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'coordinator'
      OR owner = auth.uid()
    )
  );

CREATE POLICY "Teachers update own media" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'lesson-media' AND
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'coordinator'
      OR owner = auth.uid()
    )
  );

CREATE POLICY "Teachers delete own media" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'lesson-media' AND
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'coordinator'
      OR owner = auth.uid()
    )
  );
