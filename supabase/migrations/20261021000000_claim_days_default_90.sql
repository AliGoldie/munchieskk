-- Owner decision: contest prizes can be claimed for 90 days.
-- New contests default to 90 (the Admin form also defaults to 90).
-- Existing contests keep whatever they were saved with. Safe to run twice.

ALTER TABLE public.arcade_contests ALTER COLUMN claim_days SET DEFAULT 90;
