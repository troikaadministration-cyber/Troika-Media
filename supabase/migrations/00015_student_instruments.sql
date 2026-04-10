-- Migration 00015: Allow students to be enrolled in multiple instruments/subjects

CREATE TABLE IF NOT EXISTS student_instruments (
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, instrument_id)
);

CREATE INDEX idx_student_instruments_student ON student_instruments(student_id);
CREATE INDEX idx_student_instruments_instrument ON student_instruments(instrument_id);

ALTER TABLE student_instruments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Coordinators manage student instruments" ON student_instruments
  FOR ALL USING (jwt_role() = 'coordinator');

CREATE POLICY "Teachers view student instruments" ON student_instruments
  FOR SELECT USING (jwt_role() = 'teacher');

CREATE POLICY "Students view own instruments" ON student_instruments
  FOR SELECT USING (
    jwt_role() = 'student'
    AND student_id = get_student_id()
  );

-- Migrate existing instrument_id into the new table
INSERT INTO student_instruments (student_id, instrument_id)
SELECT id, instrument_id FROM students
WHERE instrument_id IS NOT NULL
ON CONFLICT DO NOTHING;
