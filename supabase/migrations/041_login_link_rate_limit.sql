-- 041: Rate limiting for passwordless sign-in link requests.
--
-- The magic-link sender (sendPasswordlessLoginLink) generates links via the
-- service-role admin API and emails them through our own provider, which
-- bypasses GoTrue's built-in email throttles. Without a limit, the public
-- login form is an email-bombing / junk-account vector. This table records
-- each request so the action can enforce per-email and per-IP windows
-- (thresholds live in lib/rate-limit.ts).

CREATE TABLE public.login_link_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  ip TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX login_link_requests_email_idx
  ON public.login_link_requests (email, requested_at);
CREATE INDEX login_link_requests_ip_idx
  ON public.login_link_requests (ip, requested_at);

-- Deny-all RLS: no policies. Only the service-role DAL
-- (lib/db/login-links.ts) touches this table.
ALTER TABLE public.login_link_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.login_link_requests IS
  'Sign-in link request log for rate limiting the passwordless login form. Rows are pruned opportunistically after 24h.';
