-- Migration: per-enrolment discount
--
-- Adds an optional discount to student_enrolments. The discount is a percentage
-- of tuition OR a flat rupee amount, applied to tuition only (rate × lessons),
-- never to the registration fee. `total_fee` continues to hold the (now
-- discounted) tuition; registration_fee stays separate.
--
-- Existing rows get discount_value = 0 (no discount), so billing is unchanged.

ALTER TABLE student_enrolments
  ADD COLUMN IF NOT EXISTS discount_kind TEXT NOT NULL DEFAULT 'percent'
    CHECK (discount_kind IN ('percent', 'amount')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (discount_value >= 0);
