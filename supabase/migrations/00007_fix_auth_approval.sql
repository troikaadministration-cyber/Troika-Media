-- Migration 00007: Fix auth flow + account approval system
-- 1. Fix handle_new_user() to never crash (ON CONFLICT DO NOTHING, empty full_name)
-- 2. Add approved column to profiles for coordinator approval workflow
-- 3. Fix link_or_create_student() with exception handling

-- ============================================================
-- A. Add approved column to profiles
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT NULL;

-- Auto-approve existing coordinators
UPDATE profiles SET approved = true WHERE role = 'coordinator' AND approved IS NULL;

-- Auto-approve existing users who already have a full_name set (already active)
UPDATE profiles SET approved = true WHERE full_name IS NOT NULL AND full_name != '' AND approved IS NULL;

-- ============================================================
-- B. Fix handle_new_user() — ultra-simple, no student operations
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    'student',
    '',  -- Empty full_name forces RoleSetup
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- C. Fix link_or_create_student() — add exception handling
-- ============================================================
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

  -- 3. No existing record found — create a new one (with exception handling)
  BEGIN
    INSERT INTO students (full_name, email, user_id, is_active, payment_plan)
    VALUES (p_full_name, COALESCE(p_email, ''), p_user_id, true, 'trial')
    RETURNING id INTO v_student_id;
  EXCEPTION WHEN unique_violation THEN
    -- user_id already linked (race condition) — find the existing record
    SELECT id INTO v_student_id
    FROM students
    WHERE user_id = p_user_id
    LIMIT 1;
  END;

  RETURN v_student_id;
END;
$$;
