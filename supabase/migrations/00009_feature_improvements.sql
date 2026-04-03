-- Migration 00009: Feature Improvements
-- Adds: new lesson types, cancellation tracking, makeup direction,
-- break scheduling, multi-instrument enrolments, charge flag

-- ============================================================
-- 1. Expand lesson_type enum
-- ============================================================
ALTER TYPE lesson_type ADD VALUE IF NOT EXISTS 'demo';
ALTER TYPE lesson_type ADD VALUE IF NOT EXISTS 'workshop';
ALTER TYPE lesson_type ADD VALUE IF NOT EXISTS 'one_time';

-- ============================================================
-- 2. New columns on lessons table
-- ============================================================
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_charged BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cancelled_by_role TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID REFERENCES profiles(id);
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS makeup_direction TEXT;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_break_id UUID;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS pending_reschedule BOOLEAN NOT NULL DEFAULT false;

-- Constraints
ALTER TABLE lessons ADD CONSTRAINT lessons_cancelled_by_role_check
  CHECK (cancelled_by_role IS NULL OR cancelled_by_role IN ('student', 'teacher', 'coordinator'));
ALTER TABLE lessons ADD CONSTRAINT lessons_makeup_direction_check
  CHECK (makeup_direction IS NULL OR makeup_direction IN ('teacher_teaching', 'teacher_learning'));

-- Index for pending reschedule queries
CREATE INDEX IF NOT EXISTS idx_lessons_pending_reschedule
  ON lessons(pending_reschedule) WHERE pending_reschedule = true;

-- ============================================================
-- 3. scheduled_breaks table
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES profiles(id),
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  student_ids UUID[] NOT NULL DEFAULT '{}',
  total_cancelled INTEGER NOT NULL DEFAULT 0,
  total_rescheduled INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT break_dates_valid CHECK (end_date >= start_date)
);

-- Foreign key from lessons.source_break_id
ALTER TABLE lessons ADD CONSTRAINT lessons_source_break_fkey
  FOREIGN KEY (source_break_id) REFERENCES scheduled_breaks(id) ON DELETE SET NULL;

-- RLS for scheduled_breaks
ALTER TABLE scheduled_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage scheduled_breaks"
  ON scheduled_breaks FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coordinator')
  );

CREATE POLICY "Teachers read affected breaks"
  ON scheduled_breaks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM lessons l
      WHERE l.source_break_id = scheduled_breaks.id
        AND l.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Students read own breaks"
  ON scheduled_breaks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM students s
      WHERE s.user_id = auth.uid()
        AND s.id = ANY(scheduled_breaks.student_ids)
    )
  );

-- ============================================================
-- 4. Remove UNIQUE constraint on student_enrolments
-- ============================================================
ALTER TABLE student_enrolments DROP CONSTRAINT IF EXISTS student_enrolments_student_id_academic_year_key;

-- ============================================================
-- 5. Update fn_increment_lessons_used trigger
--    Skip incrementing for is_charged=false or teacher_learning makeup
-- ============================================================
CREATE OR REPLACE FUNCTION fn_increment_lessons_used()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  ls RECORD;
  acad_year TEXT;
BEGIN
  -- Only fire when lesson status changes to 'completed'
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    -- Skip if lesson is not charged or is a teacher-learning makeup
    IF NEW.is_charged = false OR NEW.makeup_direction = 'teacher_learning' THEN
      RETURN NEW;
    END IF;

    -- Determine academic year from lesson date
    acad_year := EXTRACT(YEAR FROM NEW.date)::TEXT;

    -- For each student in this lesson who attended or has a charged absence
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
  RETURN NEW;
END;
$$;
