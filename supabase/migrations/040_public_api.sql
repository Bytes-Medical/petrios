-- 040: Public API v1 + webhooks.
--
-- api_tokens: org-scoped bearer tokens for /api/v1. Only the sha256 hash is
-- stored — the plaintext ("bt_..." prefix) is shown once at creation.
-- webhook_endpoints/deliveries: org-admin-registered HTTPS endpoints that
-- receive signed event POSTs (X-Bytes-Signature HMAC).
--
-- All deny-all RLS: managed through org-admin-gated server actions and the
-- API auth layer via the service DAL (lib/db/api-platform.ts).

CREATE TABLE public.api_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,      -- e.g. "bt_3fa9…" for display only
  scopes TEXT[] NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX api_tokens_org_idx ON public.api_tokens (org_id);

CREATE TABLE public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,            -- HMAC key for X-Bytes-Signature
  events TEXT[] NOT NULL,          -- e.g. {'session.published','certificate.issued'}
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_endpoints_org_idx ON public.webhook_endpoints (org_id) WHERE active;

CREATE TABLE public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  response_code INT,
  attempts INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX webhook_deliveries_endpoint_idx
  ON public.webhook_deliveries (endpoint_id, created_at DESC);

ALTER TABLE public.api_tokens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
