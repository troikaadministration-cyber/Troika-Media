-- Migration: make lessons_used drift-free (recompute instead of increment)
--
-- The old trigger only incremented on scheduled->completed and never
-- decremented, so complete->pending->complete double-counted, and completing a
-- lesson before marking attendance counted zero forever. Replace the delta
-- trigger with a full recompute keyed on the actual lesson/attendance state, so
-- the counter is always correct regardless of the order of edits.

-- Recompute a student's used-lesson count for one academic year.
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

-- When a lesson's status/charge/direction/date changes, recompute every
-- enrolled student (and both years if the date crossed a year boundary).
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

-- When attendance/absence membership changes, recompute that student.
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

-- Replace the old increment trigger.
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

-- One-time reconciliation of existing (possibly drifted) counters.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT student_id, academic_year FROM student_enrolments LOOP
    PERFORM fn_recompute_lessons_used(r.student_id, r.academic_year);
  END LOOP;
END $$;
