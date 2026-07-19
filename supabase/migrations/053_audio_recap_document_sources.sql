-- 053: Make every newly generated audio recap traceable to the exact set of
-- available private session documents supplied to the LLM. Existing recaps
-- remain legacy rows with no digest and are treated as stale until regenerated.

ALTER TABLE public.audio_recaps
  ADD COLUMN source_documents JSONB NOT NULL DEFAULT '[]'::JSONB,
  ADD COLUMN source_digest TEXT;

ALTER TABLE public.audio_recaps
  ADD CONSTRAINT audio_recaps_source_documents_array
    CHECK (jsonb_typeof(source_documents) = 'array'),
  ADD CONSTRAINT audio_recaps_source_digest_format
    CHECK (source_digest IS NULL OR source_digest ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.audio_recaps.source_documents IS
  'Ordered snapshot of private session-document ids, filenames, MIME types, byte sizes, and SHA-256 values supplied to the recap LLM.';
COMMENT ON COLUMN public.audio_recaps.source_digest IS
  'SHA-256 of the canonical source_documents snapshot; NULL marks a legacy/non-document-backed recap.';
