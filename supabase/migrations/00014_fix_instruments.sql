-- Migration 00014: Fix instruments to only the ones taught at Troika

-- Remove instruments not taught here
-- Safe: SET NULL on any lessons/students referencing these before deleting
UPDATE lessons SET instrument_id = NULL
  WHERE instrument_id IN (SELECT id FROM instruments WHERE name IN ('Flute','Drums','Clarinet','Saxophone','Trumpet','Keyboard'));
UPDATE students SET instrument_id = NULL
  WHERE instrument_id IN (SELECT id FROM instruments WHERE name IN ('Flute','Drums','Clarinet','Saxophone','Trumpet','Keyboard'));

DELETE FROM instruments WHERE name IN ('Flute','Drums','Clarinet','Saxophone','Trumpet','Keyboard');

-- Add missing instruments
INSERT INTO instruments (name) VALUES
  ('IGCSE Music'),
  ('Music Theory')
ON CONFLICT (name) DO NOTHING;
