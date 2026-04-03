-- Migration 00008: Teacher schedule templates
-- Recurring weekly time slots that coordinators can assign to teachers
-- Used to generate lessons in bulk for a date range

CREATE TABLE IF NOT EXISTS teacher_schedule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time TIME NOT NULL,
  end_time TIME,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  student_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_templates_teacher ON teacher_schedule_templates(teacher_id);
CREATE INDEX idx_schedule_templates_day ON teacher_schedule_templates(day_of_week);

-- Updated_at trigger
CREATE TRIGGER set_updated_at BEFORE UPDATE ON teacher_schedule_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS policies
ALTER TABLE teacher_schedule_templates ENABLE ROW LEVEL SECURITY;

-- Coordinators can do everything
CREATE POLICY "Coordinators manage schedule templates"
  ON teacher_schedule_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'coordinator')
  );

-- Teachers can view their own templates
CREATE POLICY "Teachers view own templates"
  ON teacher_schedule_templates FOR SELECT
  USING (teacher_id = auth.uid());
