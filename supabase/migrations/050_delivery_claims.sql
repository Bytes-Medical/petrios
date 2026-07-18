-- 050: Atomic, recoverable claims for outbound session deliveries.

ALTER TABLE public.session_deliveries
  DROP CONSTRAINT IF EXISTS session_deliveries_status_check,
  ADD CONSTRAINT session_deliveries_status_check
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED'));

CREATE INDEX IF NOT EXISTS session_deliveries_stale_claim_idx
  ON public.session_deliveries (last_attempt_at)
  WHERE status = 'SENDING';
