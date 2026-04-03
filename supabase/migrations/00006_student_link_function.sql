-- Migration 00006: Student account linking function
-- When a student signs up, this function links them to an existing
-- coordinator-created student record (matched by email), or creates a new one.
-- SECURITY DEFINER bypasses RLS so the student can find/update records
-- where user_id IS NULL.

CREATE OR REPLACE FUNCTION link_or_create_student(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student_id UUID;
BEGIN
  -- 1. Check if this user already has a student record
  SELECT id INTO v_student_id
  FROM students
  WHERE user_id = p_user_id
  LIMIT 1;

  IF v_student_id IS NOT NULL THEN
    RETURN v_student_id;
  END IF;

  -- 2. Try to link to an existing coordinator-created record by email
  IF p_email IS NOT NULL AND p_email != '' THEN
    SELECT id INTO v_student_id
    FROM students
    WHERE email = p_email
      AND user_id IS NULL
    LIMIT 1;

    IF v_student_id IS NOT NULL THEN
      UPDATE students
      SET user_id = p_user_id,
          full_name = p_full_name,
          updated_at = now()
      WHERE id = v_student_id;

      RETURN v_student_id;
    END IF;
  END IF;

  -- 3. No existing record found — create a new one
  INSERT INTO students (full_name, email, user_id, is_active, payment_plan)
  VALUES (p_full_name, COALESCE(p_email, ''), p_user_id, true, 'trial')
  RETURNING id INTO v_student_id;

  RETURN v_student_id;
END;
$$;
