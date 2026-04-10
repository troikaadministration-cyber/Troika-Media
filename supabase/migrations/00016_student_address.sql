-- Migration 00016: Add free-text address field to students

ALTER TABLE students ADD COLUMN IF NOT EXISTS address TEXT;
