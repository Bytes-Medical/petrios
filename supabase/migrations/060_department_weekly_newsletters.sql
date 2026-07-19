-- 060: Moderator-triggered, department-scoped weekly teaching newsletters.
--
-- Legacy organization-wide issues remain readable with department_id NULL.
-- New issues snapshot their reviewed content and teaching-material provenance;
-- per-recipient rows make partial delivery visible and retryable.

ALTER TABLE public.ops_newsletter_issues
  ADD COLUMN department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  ADD COLUMN generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN content JSONB,
  ADD COLUMN source_session_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN source_documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.ops_newsletter_issues
  ADD CONSTRAINT ops_newsletter_issues_content_object
    CHECK (content IS NULL OR jsonb_typeof(content) = 'object'),
  ADD CONSTRAINT ops_newsletter_issues_source_documents_array
    CHECK (jsonb_typeof(source_documents) = 'array'),
  ADD CONSTRAINT ops_newsletter_issues_content_revision_positive
    CHECK (content_revision > 0);

ALTER TABLE public.ops_newsletter_issues
  DROP CONSTRAINT ops_newsletter_issues_org_id_week_start_key;

CREATE UNIQUE INDEX ops_newsletter_issues_department_week_key
  ON public.ops_newsletter_issues (org_id, department_id, week_start)
  WHERE department_id IS NOT NULL;

CREATE UNIQUE INDEX ops_newsletter_issues_legacy_org_week_key
  ON public.ops_newsletter_issues (org_id, week_start)
  WHERE department_id IS NULL;

CREATE INDEX ops_newsletter_issues_department_recent_idx
  ON public.ops_newsletter_issues (department_id, week_start DESC)
  WHERE department_id IS NOT NULL;

CREATE TABLE public.ops_newsletter_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.ops_newsletter_issues(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  content_revision INTEGER NOT NULL CHECK (content_revision > 0),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  provider_message_id TEXT,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, recipient_user_id)
);

CREATE INDEX ops_newsletter_deliveries_retry_idx
  ON public.ops_newsletter_deliveries (issue_id, status, updated_at);

ALTER TABLE public.ops_newsletter_deliveries ENABLE ROW LEVEL SECURITY;
-- Deny-all RLS. Only the moderator-gated Ops service DAL/executor can access.

CREATE OR REPLACE FUNCTION public.claim_ops_newsletter_delivery_v1(
  p_delivery_id UUID
) RETURNS public.ops_newsletter_deliveries AS $$
DECLARE
  v_result public.ops_newsletter_deliveries%ROWTYPE;
BEGIN
  UPDATE public.ops_newsletter_deliveries
  SET status = 'SENDING',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE id = p_delivery_id
    AND (
      status IN ('PENDING', 'FAILED')
      OR (status = 'SENDING' AND claimed_at < now() - INTERVAL '10 minutes')
    )
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_ops_newsletter_delivery_v1(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_ops_newsletter_delivery_v1(UUID) TO service_role;

COMMENT ON COLUMN public.ops_newsletter_issues.source_documents IS
  'Generation-time session/document id, filename, MIME, byte-size and SHA-256 provenance; document contents are not stored here.';
COMMENT ON TABLE public.ops_newsletter_deliveries IS
  'Per-member delivery ledger for a reviewed department newsletter; SENT rows are never emailed again.';
