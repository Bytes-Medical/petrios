-- 042: "You said, we did" — moderator-authored responses to feedback themes,
-- shown publicly on feedback pages to close the loop with attendees.

CREATE TABLE public.feedback_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,   -- "you said"
  action TEXT NOT NULL,  -- "we did"
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX feedback_actions_session_idx
  ON public.feedback_actions (session_id);
CREATE INDEX feedback_actions_department_idx
  ON public.feedback_actions (department_id, created_at DESC);

-- Deny-all RLS: no policies. Service-role DAL only
-- (lib/db/feedback-actions.ts); public reads are an intentional product
-- surface (moderator-authored text on public feedback pages).
ALTER TABLE public.feedback_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.feedback_actions IS
  '"You said, we did" entries: moderator responses to session feedback themes, displayed on public feedback pages.';
