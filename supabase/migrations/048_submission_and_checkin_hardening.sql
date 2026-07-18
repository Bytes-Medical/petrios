-- 048: Prevent replayed identified feedback and throttle group-code guessing.

ALTER TABLE public.session_feedback
  ADD COLUMN IF NOT EXISTS submission_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS session_feedback_submission_key_unique
  ON public.session_feedback (session_id, submission_key)
  WHERE submission_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.attendance_code_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_hash TEXT,
  successful BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_code_attempts_user_idx
  ON public.attendance_code_attempts (session_id, user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS attendance_code_attempts_ip_idx
  ON public.attendance_code_attempts (session_id, ip_hash, attempted_at DESC)
  WHERE ip_hash IS NOT NULL;
ALTER TABLE public.attendance_code_attempts ENABLE ROW LEVEL SECURITY;
-- Deny-all: the authorized server action uses a service DAL.
