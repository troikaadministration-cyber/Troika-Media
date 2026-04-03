-- Troika Music Lessons - Initial Schema (full rewrite)

-- Enums
CREATE TYPE user_role AS ENUM ('coordinator', 'teacher', 'student');
CREATE TYPE lesson_type AS ENUM ('regular', 'makeup', 'special');
CREATE TYPE lesson_status AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE absence_category AS ENUM ('charged', 'not_charged');
CREATE TYPE payment_plan AS ENUM ('trial', '1_instalment', '3_instalments', '10_instalments');
CREATE TYPE piece_status AS ENUM ('not_started', 'in_progress', 'completed');
CREATE TYPE resource_type AS ENUM ('piece', 'exercise', 'activity');
CREATE TYPE resource_level AS ENUM ('beginner', 'intermediate', 'advanced');
CREATE TYPE notification_type AS ENUM ('general', 'payment_reminder', 'lesson_cancelled', 'lesson_updated', 'attendance_marked', 'makeup_available');

-- Profiles (extends auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'student',
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_role ON profiles(role);

-- Locations
CREATE TABLE locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  zone TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Instruments
CREATE TABLE instruments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Students
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  parent_name TEXT,
  parent_phone TEXT,
  parent_email TEXT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL,
  payment_plan payment_plan NOT NULL DEFAULT 'trial',
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_user_id ON students(user_id);
CREATE INDEX idx_students_location ON students(location_id);
CREATE INDEX idx_students_instrument ON students(instrument_id);
CREATE INDEX idx_students_is_active ON students(is_active);

-- Lessons
CREATE TABLE lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL,
  lesson_type lesson_type NOT NULL DEFAULT 'regular',
  status lesson_status NOT NULL DEFAULT 'scheduled',
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT,
  cancelled_by_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lessons_end_after_start CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE INDEX idx_lessons_teacher ON lessons(teacher_id);
CREATE INDEX idx_lessons_date ON lessons(date);
CREATE INDEX idx_lessons_status ON lessons(status);
CREATE INDEX idx_lessons_teacher_date ON lessons(teacher_id, date);

-- Lesson-Student junction
CREATE TABLE lesson_students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attended BOOLEAN,
  absence_category absence_category,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lesson_id, student_id)
);

CREATE INDEX idx_lesson_students_lesson ON lesson_students(lesson_id);
CREATE INDEX idx_lesson_students_student ON lesson_students(student_id);

-- Student pieces (repertoire)
CREATE TABLE student_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status piece_status NOT NULL DEFAULT 'not_started',
  added_date DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_student_pieces_student ON student_pieces(student_id);

-- Media uploads
CREATE TABLE media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  supabase_path TEXT NOT NULL,
  google_drive_url TEXT,
  synced_to_drive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_uploads_lesson ON media_uploads(lesson_id);

-- Curriculum resources
CREATE TABLE curriculum_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  type resource_type NOT NULL DEFAULT 'piece',
  level resource_level NOT NULL DEFAULT 'beginner',
  teaching_tip TEXT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  source_file TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Curriculum tags
CREATE TABLE curriculum_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resource-Tag junction
CREATE TABLE curriculum_resource_tags (
  resource_id UUID NOT NULL REFERENCES curriculum_resources(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES curriculum_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, tag_id)
);

CREATE INDEX idx_resource_tags_resource ON curriculum_resource_tags(resource_id);
CREATE INDEX idx_resource_tags_tag ON curriculum_resource_tags(tag_id);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type notification_type NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = false;

-- Payment records
CREATE TABLE payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  plan payment_plan NOT NULL,
  amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  instalment_number INTEGER NOT NULL DEFAULT 1,
  due_date DATE NOT NULL,
  paid_date DATE,
  reminder_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_amount_non_negative CHECK (amount >= 0),
  CONSTRAINT payment_instalment_positive CHECK (instalment_number >= 1)
);

CREATE INDEX idx_payment_records_student ON payment_records(student_id);
CREATE INDEX idx_payment_records_due ON payment_records(due_date);
CREATE INDEX idx_payment_records_unpaid_due ON payment_records(due_date) WHERE paid_date IS NULL;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON student_pieces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON curriculum_resources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup (idempotent, hardcoded student role)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, role, full_name, email)
  VALUES (
    NEW.id,
    'student',
    COALESCE(NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')), ''), ''),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Seed instruments
INSERT INTO instruments (name, icon) VALUES
  ('Piano', '🎹'),
  ('Violin', '🎻'),
  ('Flute', '🎵'),
  ('Guitar', '🎸'),
  ('Cello', '🎻'),
  ('Voice', '🎤'),
  ('Drums', '🥁'),
  ('Clarinet', '🎵'),
  ('Saxophone', '🎷'),
  ('Trumpet', '🎺');
