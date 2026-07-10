-- 038: Evidence Engine — ARCP portfolio packs (trainees) + reflections.
--
-- session_reflections: a trainee's private post-session reflection, the
-- missing half of ARCP teaching evidence (attendance alone isn't enough).
-- Self-only RLS: users read and write exactly their own reflections.
--
-- portfolio_packs: an immutable snapshot of a generated portfolio pack.
-- The PDF carries pack_code; /verify/pack/[code] renders the stored payload
-- so third parties (ARCP panels) can check the document wasn't altered.
-- Deny-all RLS — created/read through the service DAL from self-scoped
-- actions and the public verify page.

CREATE TABLE public.session_reflections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id)
);

CREATE INDEX session_reflections_user_idx ON public.session_reflections (user_id);

ALTER TABLE public.session_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own reflections"
  ON public.session_reflections FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users write own reflections"
  ON public.session_reflections FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own reflections"
  ON public.session_reflections FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TABLE public.portfolio_packs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pack_code TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX portfolio_packs_user_idx ON public.portfolio_packs (user_id, created_at DESC);

ALTER TABLE public.portfolio_packs ENABLE ROW LEVEL SECURITY;
-- Deny-all: no policies. Service DAL only (lib/db/portfolio.ts).
