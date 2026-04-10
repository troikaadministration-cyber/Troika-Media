-- supabase/migrations/00011_lesson_categories.sql

-- 1. Create lesson_categories table
CREATE TABLE lesson_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Seed instruments (upsert so re-running is safe)
INSERT INTO instruments (name) VALUES
  ('Cello'), ('Piano'), ('Voice'), ('Guitar'), ('Violin'), ('Viola')
ON CONFLICT (name) DO NOTHING;

-- 3. Seed lesson categories
INSERT INTO lesson_categories (name, sort_order) VALUES
  ('1:1 Instrumental', 1),
  ('1:1 Theory',       2),
  ('1:1 Vocals',       3),
  ('IGCSE Music',      4),
  ('Music Theory',     5),
  ('Group: Strings',   6),
  ('Group: Guitar',    7),
  ('Group: Vocals',    8),
  ('Group: Theory',    9)
ON CONFLICT (name) DO NOTHING;

-- 4. Migrate existing lesson_rates.category values to new names
UPDATE lesson_rates SET category = '1:1 Instrumental' WHERE category = '1:1_instrumental';
UPDATE lesson_rates SET category = '1:1 Theory'       WHERE category = '1:1_theory';
UPDATE lesson_rates SET category = '1:1 Vocals'       WHERE category = '1:1_vocals';
UPDATE lesson_rates SET category = 'Group: Strings'   WHERE category = 'group_strings';
UPDATE lesson_rates SET category = 'Group: Guitar'    WHERE category = 'group_guitar';
UPDATE lesson_rates SET category = 'Group: Vocals'    WHERE category = 'group_vocals';
UPDATE lesson_rates SET category = 'Group: Theory'    WHERE category = 'group_theory';

-- 5. RLS
ALTER TABLE lesson_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view lesson categories" ON lesson_categories
  FOR SELECT USING (true);

CREATE POLICY "Coordinators manage lesson categories" ON lesson_categories
  FOR ALL USING (get_user_role() = 'coordinator');
