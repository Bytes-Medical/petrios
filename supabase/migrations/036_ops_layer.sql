-- 036: Petrios Ops — additive AI agent layer.
--
-- Design contract (see CLAUDE.md "Petrios Ops"):
--   * This migration only CREATEs ops_* tables. It never alters existing
--     tables — the ops layer must be droppable without touching the core app.
--   * Every table is deny-all RLS (enabled, no policies): all access goes
--     through the service-role DAL in lib/db/ops.ts, gated by
--     requireOrgManager in server actions or CRON_SECRET in cron routes.
--     (The spec's dedicated read-only DB role isn't provisionable from app
--     migrations; deny-all RLS + DAL discipline is the equivalent boundary.)
--   * No outbound email exists without a row in ops_pending_actions that a
--     human approved. Executors are the only send paths.

-- ---------------------------------------------------------------------------
-- Approval gate: every outbound action the agent proposes waits here.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_pending_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('SPEAKER_CHASE_EMAIL','THANK_YOU_EMAIL','NEWSLETTER_ISSUE','CUSTOM_EMAIL')),
  payload JSONB NOT NULL,
  preview_title TEXT NOT NULL,
  preview_body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','executed','failed')),
  created_by TEXT NOT NULL DEFAULT 'system',  -- 'system' (cron) or a user id (chat)
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ops_pending_actions_org_status_idx
  ON public.ops_pending_actions (org_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit trail: one run per cron invocation / chat turn, steps within it.
-- Steps record prompt HASHES and token counts, never raw prompt text.
-- Append-only by DAL discipline (no update functions besides finishing a run).
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,  -- NULL = platform-wide
  kind TEXT NOT NULL,      -- 'ops_weekly' | 'ops_synthesis' | 'ops_newsletter' | 'assistant_chat'
  trigger TEXT NOT NULL,   -- 'cron' | 'chat' | 'manual'
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX ops_agent_runs_recent_idx ON public.ops_agent_runs (started_at DESC);

CREATE TABLE public.ops_agent_run_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id UUID NOT NULL REFERENCES public.ops_agent_runs(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  name TEXT NOT NULL,
  detail JSONB,
  purpose TEXT,        -- set on LLM steps: gateway purpose allow-list value
  model TEXT,
  prompt_hash TEXT,    -- sha256 of system+prompt; raw text is never stored
  input_tokens INT,
  output_tokens INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ops_agent_run_steps_run_idx ON public.ops_agent_run_steps (run_id, seq);

-- ---------------------------------------------------------------------------
-- Feedback synthesis artifacts. One per session; safety-railed content only
-- (names stripped, welfare content excluded from themes and flagged).
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_feedback_syntheses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive','mixed','negative')),
  suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
  quotes JSONB NOT NULL DEFAULT '[]'::jsonb,
  requires_human_review BOOLEAN NOT NULL DEFAULT FALSE,
  response_count INT NOT NULL DEFAULT 0,
  average_rating NUMERIC,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Curriculum layer: seeded reference domains + session mappings with an
-- explicit confidence tier so deterministic matches are distinguishable from
-- LLM guesses.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_curriculum_domains (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort INT NOT NULL DEFAULT 0
);

-- Editable reference data: the 11 RCPCH Progress+ curriculum domains.
-- Verify names against the official RCPCH Progress+ publication before
-- relying on coverage reports; update rows here if the college revises them.
INSERT INTO public.ops_curriculum_domains (code, name, description, sort) VALUES
  ('professional_values',  'Professional values and behaviours', 'Ethics, probity, wellbeing and professional conduct', 1),
  ('communication',        'Communication',                      'Communication with children, families and colleagues', 2),
  ('procedures',           'Procedures',                         'Practical procedures and procedural safety', 3),
  ('patient_management',   'Patient management',                 'Assessment, diagnosis and management of paediatric presentations', 4),
  ('health_promotion',     'Health promotion and illness prevention', 'Public health, immunisation, prevention and advocacy', 5),
  ('leadership_teamwork',  'Leadership and team working',        'Team working, leadership and organisational skills', 6),
  ('patient_safety',       'Patient safety including safe prescribing', 'Safety science, human factors and safe prescribing', 7),
  ('quality_improvement',  'Quality improvement',                'QI methodology, audit and service evaluation', 8),
  ('safeguarding',         'Safeguarding',                       'Recognition and management of safeguarding concerns', 9),
  ('education_training',   'Education and training',             'Teaching, supervision, assessment and educational theory', 10),
  ('research_scholarship', 'Research and scholarship',           'Evidence-based practice, critical appraisal and research methods', 11)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.ops_curriculum_map (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  domain_code TEXT NOT NULL REFERENCES public.ops_curriculum_domains(code) ON DELETE CASCADE,
  confidence TEXT NOT NULL CHECK (confidence IN ('deterministic','llm_high','llm_low')),
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, domain_code)
);

CREATE INDEX ops_curriculum_map_org_idx ON public.ops_curriculum_map (org_id, domain_code);

-- ---------------------------------------------------------------------------
-- Speaker-chase bookkeeping: caps escalation at N chases per target/session.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_speaker_chases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  target_invitation_id UUID REFERENCES public.teacher_invitations(id) ON DELETE CASCADE,
  target_email TEXT NOT NULL,
  chase_count INT NOT NULL DEFAULT 0,
  last_chased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, target_email)
);

-- ---------------------------------------------------------------------------
-- Agent memory: durable org-scoped notes ("prefers Tuesday lunchtimes").
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'assistant',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Weekly learning-points newsletter. The issue itself is the draft artifact;
-- sending happens only via an approved NEWSLETTER_ISSUE pending action.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_newsletter_issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  summary_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','failed')),
  pending_action_id UUID REFERENCES public.ops_pending_actions(id) ON DELETE SET NULL,
  sent_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, week_start)
);

CREATE TABLE public.ops_newsletter_optouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Organiser assistant chat history.
-- ---------------------------------------------------------------------------
CREATE TABLE public.ops_chat_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ops_chat_threads_user_idx ON public.ops_chat_threads (user_id, updated_at DESC);

CREATE TABLE public.ops_chat_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES public.ops_chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  tool_summary JSONB,   -- [{name, ok}] trace of tools the assistant used
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ops_chat_messages_thread_idx ON public.ops_chat_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Deny-all RLS: enable on every ops table, define no policies. Only the
-- service-role DAL (lib/db/ops.ts) can touch these rows.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ops_pending_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_agent_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_agent_run_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_feedback_syntheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_curriculum_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_curriculum_map     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_speaker_chases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_memory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_newsletter_issues  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_newsletter_optouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_chat_threads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_chat_messages      ENABLE ROW LEVEL SECURITY;
