-- 054: Preserve the authoritative web sources consulted when generating a
-- document-grounded Audio Recap. The moderator UI renders these as clickable
-- citations; legacy recaps retain an empty source list.

ALTER TABLE public.audio_recaps
  ADD COLUMN research_sources JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN research_performed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.audio_recaps
  ADD CONSTRAINT audio_recaps_research_sources_array
    CHECK (jsonb_typeof(research_sources) = 'array'),
  ADD CONSTRAINT audio_recaps_research_sources_limit
    CHECK (jsonb_array_length(research_sources) <= 20),
  ADD CONSTRAINT audio_recaps_research_consistency
    CHECK (research_performed OR jsonb_array_length(research_sources) = 0);

COMMENT ON COLUMN public.audio_recaps.research_sources IS
  'De-duplicated URL/title citations returned by Responses web_search for moderator review.';
COMMENT ON COLUMN public.audio_recaps.research_performed IS
  'True when generation required the hosted web_search tool; not a claim that every search returned useful evidence.';
