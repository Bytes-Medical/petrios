-- 046: Canonical recognition and feedback-report delivery state.

ALTER TABLE public.certificates
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS attendance_revision INTEGER,
  ADD COLUMN IF NOT EXISTS issuance_source TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

-- Existing rows predate canonical eligibility and may contain duplicates. Keep
-- them verifiable as LEGACY while applying uniqueness to every new VALID row.
UPDATE public.certificates SET status = 'LEGACY' WHERE status IS NULL;
ALTER TABLE public.certificates
  ALTER COLUMN status SET DEFAULT 'VALID',
  ALTER COLUMN status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS certificates_status_check,
  ADD CONSTRAINT certificates_status_check CHECK (status IN ('VALID', 'REVOKED', 'LEGACY'));

CREATE UNIQUE INDEX IF NOT EXISTS certificates_one_valid_user_role
  ON public.certificates (session_id, user_id, certificate_role)
  WHERE status = 'VALID' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS certificates_one_valid_email_role
  ON public.certificates (session_id, lower(recipient_email), certificate_role)
  WHERE status = 'VALID' AND recipient_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.teacher_feedback_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'RELEASED', 'FAILED')),
  response_count INTEGER NOT NULL,
  analytics_snapshot JSONB NOT NULL,
  privacy_suppressed BOOLEAN NOT NULL DEFAULT false,
  synthesis_id UUID REFERENCES public.ops_feedback_syntheses(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, version)
);

ALTER TABLE public.teacher_feedback_reports ENABLE ROW LEVEL SECURITY;
-- Deny-all: moderator-gated service DAL.

CREATE TABLE IF NOT EXISTS public.session_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  recipient_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  related_id UUID,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_message_id TEXT,
  last_error TEXT,
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, recipient_email, delivery_type, related_id)
);

CREATE INDEX IF NOT EXISTS session_deliveries_retry_idx
  ON public.session_deliveries (status, updated_at)
  WHERE status IN ('PENDING', 'FAILED');
ALTER TABLE public.session_deliveries ENABLE ROW LEVEL SECURITY;
-- Deny-all: service delivery workers and moderator-gated reads.
