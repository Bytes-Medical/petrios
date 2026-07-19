-- 058: Persist the exact speech-provider family used for each generated Audio
-- Recap. Existing rows remain NULL because historical OpenAI-compatible base
-- URLs do not prove which underlying provider produced their audio.

ALTER TABLE public.audio_recaps
  ADD COLUMN tts_provider TEXT;

ALTER TABLE public.audio_recaps
  ADD CONSTRAINT audio_recaps_tts_provider_check
    CHECK (tts_provider IS NULL OR tts_provider IN ('openai', 'elevenlabs'));

COMMENT ON COLUMN public.audio_recaps.tts_provider IS
  'Speech-provider family used for the stored MP3; NULL marks legacy/cleared audio metadata.';

