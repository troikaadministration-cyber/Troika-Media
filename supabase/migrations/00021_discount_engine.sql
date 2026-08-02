-- Migration: discount engine (primary + multi-lesson)
--
-- Supersedes the simple percent/amount discount from 00020. A student now gets
-- ONE primary discount plus an optional Multi-lesson (+5%) that stacks:
--   discount_primary:     'none' | 'plan' | 'legacy' | 'special'
--   discount_multilesson: adds 5% when true
--   discount_value:       (reused from 00020) the flat ₹ amount when primary = 'special'
--
-- discount_kind from 00020 is left in place but no longer used by the app.
-- Existing rows default to no discount, so billing is unchanged.

ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS discount_primary TEXT NOT NULL DEFAULT 'none'
    CHECK (discount_primary IN ('none', 'plan', 'legacy', 'special')),
  ADD COLUMN IF NOT EXISTS discount_multilesson BOOLEAN NOT NULL DEFAULT false;
