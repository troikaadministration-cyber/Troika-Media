-- Migration: miscellaneous charges (recital tickets, books, exams, etc.)
--
-- Misc charges are one-off, customisable, payable add-ons. They live in
-- payment_records so they automatically appear in Payments, Reports, and get
-- invoices — distinguished by a non-null `label` and a null `plan`.
--   label: the charge name (e.g. "Recital tickets"); null for normal instalments
--   plan:  now nullable so misc charges need not belong to a payment plan

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS label TEXT;

ALTER TABLE payment_records
  ALTER COLUMN plan DROP NOT NULL;
