-- 047: Private, session-associated documents.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'session-documents',
  'session-documents',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.session_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )),
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 26214400),
  sha256 TEXT CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'UPLOADING'
    CHECK (status IN ('UPLOADING', 'AVAILABLE', 'REJECTED', 'ARCHIVED')),
  validation_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (validation_status IN ('PENDING', 'BASIC_VALIDATED', 'REJECTED')),
  validation_error TEXT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  replaces_document_id UUID REFERENCES public.session_documents(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_documents_session_idx
  ON public.session_documents (session_id, status, created_at DESC);
ALTER TABLE public.session_documents ENABLE ROW LEVEL SECURITY;
-- Deny-all: every metadata/object operation is authorized in server actions or
-- same-origin route handlers before the service DAL is used.

-- The bucket is private and browser clients receive no general object policy.
DROP POLICY IF EXISTS "Public read session documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload session documents" ON storage.objects;
