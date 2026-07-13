-- 043: AI audio recaps — organiser-approved, on-demand spoken session
-- recaps (Petrios Ops). Script drafted via the audited gateway (purpose
-- audio_recap), audio synthesized once and stored so the artifact the
-- moderator approves is exactly the artifact attendees hear.
--
-- Audio lives as BYTEA rather than object storage: one bounded MP3 per
-- session (script capped in lib/ops/recap.ts), survives pg_dump, and adds
-- no self-host surface (the app deliberately dropped Supabase Storage in
-- migration 032). Metadata queries must exclude the blob column — see
-- META_COLUMNS in lib/db/audio-recaps.ts; audio_bytes mirrors its size.

CREATE TABLE public.audio_recaps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL UNIQUE REFERENCES public.sessions(id) ON DELETE CASCADE,
  script TEXT NOT NULL,
  model TEXT,                -- LLM that drafted the script
  tts_model TEXT,
  tts_voice TEXT,
  audio BYTEA,               -- MP3; NULL until TTS runs
  audio_bytes INT,           -- size mirror so metadata reads skip the blob
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deny-all RLS: no policies. Service-role DAL only (lib/db/audio-recaps.ts);
-- moderator gating and the attendee read path live in
-- app/actions/audio-recaps.ts and /api/sessions/[id]/recap-audio.
ALTER TABLE public.audio_recaps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.audio_recaps IS
  'Moderator-approved AI audio recaps of sessions. Approved audio is immutable: editing the script clears the audio and returns to draft.';
