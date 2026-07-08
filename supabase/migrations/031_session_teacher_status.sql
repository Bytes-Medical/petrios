-- 031: Teaching assignments become accept/decline invitations.
-- Existing assignments predate the accept flow, so the column is added with
-- DEFAULT 'ACCEPTED' (backfills current rows as accepted history), then the
-- default is flipped to 'PENDING' for all new assignments. Do not reorder.

ALTER TABLE public.session_teachers
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACCEPTED'
    CHECK (status IN ('PENDING','ACCEPTED','DECLINED')),
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;

ALTER TABLE public.session_teachers
  ALTER COLUMN status SET DEFAULT 'PENDING';

COMMENT ON COLUMN public.session_teachers.status IS
  'PENDING until the teacher responds from their dashboard; existing rows were backfilled ACCEPTED.';
