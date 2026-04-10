-- Seed script: Add Troika teachers
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- Replace email addresses with the teachers' real emails before running.
-- Temporary passwords are set to 'TroikaTeacher2024!' — teachers should reset on first login.

DO $$
DECLARE
  v_noah   UUID := gen_random_uuid();
  v_aadya  UUID := gen_random_uuid();
  v_kaiv   UUID := gen_random_uuid();
  v_devraj UUID := gen_random_uuid();
  v_subaan UUID := gen_random_uuid();
BEGIN

  -- Create auth.users records
  INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, role, aud)
  VALUES
    (v_noah,   '00000000-0000-0000-0000-000000000000', 'noah@troikamedia.com',
      crypt('TroikaTeacher2024!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, 'authenticated', 'authenticated'),
    (v_aadya,  '00000000-0000-0000-0000-000000000000', 'aadya@troikamedia.com',
      crypt('TroikaTeacher2024!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, 'authenticated', 'authenticated'),
    (v_kaiv,   '00000000-0000-0000-0000-000000000000', 'kaivalya@troikamedia.com',
      crypt('TroikaTeacher2024!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, 'authenticated', 'authenticated'),
    (v_devraj, '00000000-0000-0000-0000-000000000000', 'devraj@troikamedia.com',
      crypt('TroikaTeacher2024!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, 'authenticated', 'authenticated'),
    (v_subaan, '00000000-0000-0000-0000-000000000000', 'subaan@troikamedia.com',
      crypt('TroikaTeacher2024!', gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, 'authenticated', 'authenticated')
  ON CONFLICT (email) DO NOTHING;

  -- Create profile records (role=teacher, approved=true)
  INSERT INTO profiles (id, role, full_name, email, approved)
  SELECT id, 'teacher', full_name, email, true
  FROM (VALUES
    (v_noah,   'Noah Kay',  'noah@troikamedia.com'),
    (v_aadya,  'Aadya',     'aadya@troikamedia.com'),
    (v_kaiv,   'Kaivalya',  'kaivalya@troikamedia.com'),
    (v_devraj, 'Devraj',    'devraj@troikamedia.com'),
    (v_subaan, 'Subaan',    'subaan@troikamedia.com')
  ) AS t(id, full_name, email)
  -- Only insert profile if auth user was actually created above
  WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.id)
  ON CONFLICT (id) DO UPDATE SET
    role     = 'teacher',
    approved = true,
    full_name = EXCLUDED.full_name;

END $$;
