-- Presentations: teaching slide decks (block-based, stored as JSON).
--
-- A deck belongs to an org + department (mirroring sessions) and is optionally
-- attached to a session. Slides live in a single JSONB column: an array of
-- slides, each with an array of positioned blocks (text/image/shape).
--
-- Access goes exclusively through server actions using the service client,
-- gated by requireDepartmentModerator(). RLS is enabled with no policies so the
-- anon/browser client is denied by default; the service client bypasses RLS.

CREATE TABLE IF NOT EXISTS public.presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled deck',
  theme TEXT NOT NULL DEFAULT 'default',
  slides JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presentations_org_id ON public.presentations(org_id);
CREATE INDEX IF NOT EXISTS idx_presentations_department_id ON public.presentations(department_id);
CREATE INDEX IF NOT EXISTS idx_presentations_session_id ON public.presentations(session_id);
CREATE INDEX IF NOT EXISTS idx_presentations_created_by ON public.presentations(created_by);

ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;
