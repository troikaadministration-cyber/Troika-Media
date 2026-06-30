-- Migration 00019: Cancel lock + makeup resolves pending reschedule
-- 1. Only coordinators may cancel a lesson (teachers/students blocked at DB level).
-- 2. Scheduling a makeup lesson for a student clears one of that student's
--    outstanding pending-reschedule classes ("counts as taken").

-- ============================================================
-- 1. Block non-coordinator cancellations.
--    Fires only on the scheduled/completed -> cancelled transition.
--    jwt_role() is NULL for service-role/no-user contexts -> allowed
--    (edge functions and migrations are trusted).
-- ============================================================
CREATE OR REPLACE FUNCTION block_non_coordinator_cancel()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND jwt_role() IS NOT NULL
     AND jwt_role() <> 'coordinator' THEN
    RAISE EXCEPTION 'Only a coordinator can cancel a lesson';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_block_non_coordinator_cancel ON lessons;
CREATE TRIGGER trg_block_non_coordinator_cancel
  BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION block_non_coordinator_cancel();

-- ============================================================
-- 2. When a student is linked to a scheduled makeup lesson, clear the
--    student's oldest outstanding pending-reschedule class. One makeup
--    resolves one pending obligation, regardless of which flow created it.
--    SECURITY DEFINER so the update isn't blocked by the caller's RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION resolve_pending_on_makeup()
RETURNS TRIGGER AS $$
DECLARE
  v_lesson lessons%ROWTYPE;
BEGIN
  SELECT * INTO v_lesson FROM lessons WHERE id = NEW.lesson_id;
  IF v_lesson.lesson_type <> 'makeup' OR v_lesson.status <> 'scheduled' THEN
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS trg_resolve_pending_on_makeup ON lesson_students;
CREATE TRIGGER trg_resolve_pending_on_makeup
  AFTER INSERT ON lesson_students
  FOR EACH ROW EXECUTE FUNCTION resolve_pending_on_makeup();
