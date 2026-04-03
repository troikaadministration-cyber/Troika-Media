-- Migration: Invoices, Enrolments & Lesson Rates
-- Adds invoice generation, 39-lesson countdown, and per-lesson fee structure

-- ============================================================
-- 1. lesson_rates — per-lesson fee by teacher × location × category
-- ============================================================
CREATE TABLE lesson_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN (
    '1:1_instrumental', '1:1_theory', '1:1_vocals',
    'group_strings', 'group_guitar', 'group_vocals',
    'group_theory', 'demo'
  )),
  rate_per_lesson NUMERIC(10,2) NOT NULL,
  is_online BOOLEAN NOT NULL DEFAULT false,
  academic_year TEXT NOT NULL DEFAULT '2025',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lesson_rate_positive CHECK (rate_per_lesson > 0),
  UNIQUE(teacher_id, location_id, category, is_online, academic_year)
);

-- ============================================================
-- 2. student_enrolments — 39-lesson countdown per student/year
-- ============================================================
CREATE TABLE student_enrolments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL DEFAULT '2025',
  lesson_rate_id UUID REFERENCES lesson_rates(id) ON DELETE SET NULL,
  total_lessons INTEGER NOT NULL DEFAULT 39,
  lessons_used INTEGER NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  payment_plan payment_plan NOT NULL,
  rate_per_lesson NUMERIC(10,2) NOT NULL,
  total_fee NUMERIC(10,2) NOT NULL,
  registration_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enrolment_lessons_non_negative CHECK (lessons_used >= 0),
  CONSTRAINT enrolment_fee_non_negative CHECK (total_fee >= 0),
  UNIQUE(student_id, academic_year)
);

CREATE INDEX idx_enrolments_student ON student_enrolments(student_id);

-- ============================================================
-- 3. invoices — one per verified payment
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  payment_id UUID NOT NULL UNIQUE REFERENCES payment_records(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  description TEXT,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pdf_path TEXT,
  emailed_to TEXT,
  emailed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_student ON invoices(student_id);
CREATE INDEX idx_invoices_payment ON invoices(payment_id);

-- ============================================================
-- 4. Alter payment_records — add verification columns
-- ============================================================
ALTER TABLE payment_records
  ADD COLUMN verified_at TIMESTAMPTZ,
  ADD COLUMN verified_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- ============================================================
-- 5. next_invoice_number() — sequential invoice numbering
-- ============================================================
CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  current_year TEXT;
  seq INTEGER;
BEGIN
  current_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)
  ), 0) + 1
  INTO seq
  FROM invoices
  WHERE invoice_number LIKE 'INV-' || current_year || '-%';

  RETURN 'INV-' || current_year || '-' || LPAD(seq::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- 6. generate_instalments() — create payment_records from enrolment
-- ============================================================
CREATE OR REPLACE FUNCTION generate_instalments(p_enrolment_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  num_instalments INTEGER;
  per_instalment NUMERIC(10,2);
  first_amount NUMERIC(10,2);
  i INTEGER;
  due DATE;
BEGIN
  SELECT * INTO rec FROM student_enrolments WHERE id = p_enrolment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found: %', p_enrolment_id;
  END IF;

  -- Determine number of instalments from payment plan
  CASE rec.payment_plan
    WHEN 'trial' THEN RETURN; -- no payment records for trial/demo
    WHEN '1_instalment' THEN num_instalments := 1;
    WHEN '3_instalments' THEN num_instalments := 3;
    WHEN '10_instalments' THEN num_instalments := 10;
    ELSE RAISE EXCEPTION 'Unknown payment plan: %', rec.payment_plan;
  END CASE;

  per_instalment := ROUND(rec.total_fee / num_instalments, 2);
  -- First instalment includes registration fee
  first_amount := per_instalment + rec.registration_fee;

  FOR i IN 1..num_instalments LOOP
    -- Due date spacing: 1 = all at start; 3 = start, +4mo, +8mo; 10 = monthly
    CASE num_instalments
      WHEN 1 THEN due := rec.start_date;
      WHEN 3 THEN due := rec.start_date + ((i - 1) * 4 * INTERVAL '1 month')::INTERVAL;
      WHEN 10 THEN due := rec.start_date + ((i - 1) * INTERVAL '1 month')::INTERVAL;
    END CASE;

    INSERT INTO payment_records (student_id, plan, amount, instalment_number, due_date)
    VALUES (
      rec.student_id,
      rec.payment_plan,
      CASE WHEN i = 1 THEN first_amount ELSE per_instalment END,
      i,
      due::DATE
    );
  END LOOP;
END;
$$;

-- ============================================================
-- 7. Trigger: increment lessons_used on lesson completion
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

CREATE TRIGGER trg_increment_lessons_used
  AFTER UPDATE ON lessons
  FOR EACH ROW
  EXECUTE FUNCTION fn_increment_lessons_used();

-- ============================================================
-- 8. RLS Policies
-- ============================================================

-- lesson_rates
ALTER TABLE lesson_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage lesson_rates"
  ON lesson_rates FOR ALL
  USING (get_user_role() = 'coordinator')
  WITH CHECK (get_user_role() = 'coordinator');

CREATE POLICY "Teachers read lesson_rates"
  ON lesson_rates FOR SELECT
  USING (get_user_role() = 'teacher');

CREATE POLICY "Students read lesson_rates"
  ON lesson_rates FOR SELECT
  USING (get_user_role() = 'student');

-- student_enrolments
ALTER TABLE student_enrolments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage student_enrolments"
  ON student_enrolments FOR ALL
  USING (get_user_role() = 'coordinator')
  WITH CHECK (get_user_role() = 'coordinator');

CREATE POLICY "Teachers read own students enrolments"
  ON student_enrolments FOR SELECT
  USING (
    get_user_role() = 'teacher'
    AND student_id IN (
      SELECT ls.student_id FROM lesson_students ls
      JOIN lessons l ON l.id = ls.lesson_id
      WHERE l.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Students read own enrolments"
  ON student_enrolments FOR SELECT
  USING (
    get_user_role() = 'student'
    AND student_id = get_student_id()
  );

-- invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage invoices"
  ON invoices FOR ALL
  USING (get_user_role() = 'coordinator')
  WITH CHECK (get_user_role() = 'coordinator');

CREATE POLICY "Students read own invoices"
  ON invoices FOR SELECT
  USING (
    get_user_role() = 'student'
    AND student_id = get_student_id()
  );

-- ============================================================
-- 9. Storage bucket for invoice PDFs
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Coordinators manage invoice files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'invoices' AND get_user_role() = 'coordinator')
  WITH CHECK (bucket_id = 'invoices' AND get_user_role() = 'coordinator');

CREATE POLICY "Service role manages invoice files"
  ON storage.objects FOR ALL
  USING (bucket_id = 'invoices' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'invoices' AND auth.role() = 'service_role');

-- ============================================================
-- 10. Seed 2025 lesson rates
-- ============================================================

-- Group rates (no specific teacher)
-- Group: Cello/Violin
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('group_strings', 1200.00, false, '2025');

-- Group: Guitar
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('group_guitar', 1000.00, false, '2025');

-- Group: Vocals
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('group_vocals', 1000.00, false, '2025');

-- Group: Theory Offline Thane (location-specific - will need location_id set after locations are known)
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('group_theory', 700.00, false, '2025');

-- Group: Theory Offline Others
-- Note: Insert a second row with a different location_id when locations are set up
-- For now, seed without location (general offline rate)

-- Group: Theory Online
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('group_theory', 750.00, true, '2025');

-- 1:1 Theory rates
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_theory', 1155.00, true, '2025');

INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_theory', 1350.00, false, '2025');

-- 1:1 Vocals rates
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_vocals', 1850.00, false, '2025');

INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_vocals', 1650.00, true, '2025');

-- Demo
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('demo', 1000.00, false, '2025');

-- 1:1 Instrumental rates (teacher-specific)
-- Teachers: Noah, Kay, Aadya, Kaivalya, Devraj, Subaan
-- Instruments taught: Cello, Piano, Voice, Guitar, Violin, Viola, IGCSE Music, Music Theory
-- These rates need actual teacher_id UUIDs from profiles table.
-- Use the admin Lesson Rates page to assign per-teacher rates.
-- Rate range: ₹1,250 – ₹2,000 per lesson depending on teacher × location.

-- Seed a few template 1:1 instrumental rates (without teacher_id, to be assigned via UI)
INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_instrumental', 1500.00, false, '2025');

INSERT INTO lesson_rates (category, rate_per_lesson, is_online, academic_year)
VALUES ('1:1_instrumental', 1350.00, true, '2025');

-- Ensure all instruments exist
INSERT INTO instruments (name) VALUES ('Cello') ON CONFLICT DO NOTHING;
INSERT INTO instruments (name) VALUES ('Piano') ON CONFLICT DO NOTHING;
INSERT INTO instruments (name) VALUES ('Voice') ON CONFLICT DO NOTHING;
INSERT INTO instruments (name) VALUES ('Guitar') ON CONFLICT DO NOTHING;
INSERT INTO instruments (name) VALUES ('Violin') ON CONFLICT DO NOTHING;
INSERT INTO instruments (name) VALUES ('Viola') ON CONFLICT DO NOTHING;

-- ============================================================
-- 11. Admin user setup
-- ============================================================
-- Override handle_new_user() so troika.administration@gmail.com
-- automatically gets 'coordinator' role on signup.
-- All other users still default to 'student'.
--
-- To set up the admin:
--   1. Go to Supabase Dashboard → Authentication → Users → Add User
--   2. Email: troika.administration@gmail.com
--   3. Password: Troika_2026
--   4. The trigger below auto-assigns coordinator role.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'coordinator'::user_role ELSE 'student'::user_role END,
    COALESCE(NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')), ''),
      CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'Troika Admin' ELSE '' END),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    role = CASE WHEN NEW.email = 'troika.administration@gmail.com' THEN 'coordinator'::user_role ELSE profiles.role END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- If admin already exists in profiles (from a previous signup), fix their role now
UPDATE profiles SET role = 'coordinator', full_name = COALESCE(NULLIF(full_name, ''), 'Troika Admin')
  WHERE email = 'troika.administration@gmail.com';

-- Apply updated_at trigger to student_enrolments
CREATE TRIGGER set_updated_at_enrolments
  BEFORE UPDATE ON student_enrolments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
