# 09 — Platform: public API, webhooks, federation, self-hosting

The open-platform layer: everything that makes Petrios deployable on
your own infrastructure and integrable with other systems.

## Provider adapters (self-hosting)

- **Email** (`lib/email.ts`): one adapter interface, three transports by
  env priority — `SMTP_HOST` (nodemailer, trust relays) → `RESEND_API_KEY`
  (REST via fetch) → dev console sink. Call sites never know the transport.
- **AI** (`lib/ai/llm.ts`): `OPENAI_BASE_URL` points the OpenAI-compatible
  client at Azure/gateways/local models; unset `OPENAI_API_KEY` disables AI
  gracefully. `lib/ops/agent-loop.ts` inherits via
  `postOpenAiChatCompletion`.
- **Video**: `NEXT_PUBLIC_JITSI_DOMAIN` (spec/04). **Deploy**: standalone
  output + `Dockerfile`/`docker-compose.yml`; `/api/health` reports db
  reachability; `scripts/migrate.mjs` applies migrations over
  `DATABASE_URL` (tracked in `_bytes_migrations`; enum migrations run
  outside transactions). Guide: `docs/self-hosting.md`.

## Public API v1 (`/api/v1`, spec: `public/openapi.json`, guide: `docs/api.md`)

- **Auth** (`lib/api/auth.ts`): `Bearer pt_<48hex>` tokens, sha256-hashed at
  rest (`api_tokens`, migration 040, deny-all RLS), org-scoped with explicit
  scopes (`read:sessions`, `write:sessions`, `read:attendance`,
  `read:certificates`, `read:departments`, `read:slots`). Org scope comes
  from the token — never from the request. Tokens are created/revoked by
  org admins in Settings; plaintext shown once.
- **Routes** are thin: `authenticateApiRequest(request, scope)` →
  service-role reads (`lib/db/api-reads.ts` — SELECTs plus two sanctioned
  writes: draft-session create and publish) → stable serializers
  (`lib/api/serializers.ts`; removing/renaming fields = breaking change).
  Errors: `{error, code}`.
- No rate limiting yet (ROADMAP) — documented in docs/api.md.

## Webhooks (`lib/webhooks.ts`)

- Events: `session.published`, `attendance.computed`, `certificate.issued`,
  `slot.claimed`. Emitted at: `updateSession` publish transition + API
  publish route; post-session cron; certificate issue in that cron; slot
  `performClaim`.
- Contract: POST with `X-Petrios-Event` and `X-Petrios-Signature: sha256=HMAC`
  over the raw body, keyed by the per-endpoint secret; 5s timeout; one
  attempt; result logged to `webhook_deliveries`.
- **Invariants**: `emitWebhook` is fire-and-forget and never throws into the
  caller; URLs are SSRF-checked (`isBlockedWebhookUrl` — http(s) only,
  private ranges blocked in production).

## Federation v1 (`lib/federation.ts`)

- Instance identity: Ed25519 from `INSTANCE_SIGNING_KEY` (pkcs8 DER,
  base64; `scripts/generate-instance-key.mjs`); public key served at
  `/.well-known/petrios` (public route in proxy.ts). Unset key =
  feature disabled with a clear message.
- Record format `petrios-record/v1`: `{format, issuer, issued_at,
  public_key, subject, attendance[], certificates[], coverage[], signature}`
  — signature is Ed25519 over the **canonical JSON** (recursively sorted
  keys, `canonicalize()`) of everything except `signature`.
- Export: `exportTeachingRecord()` (self-scoped, Portfolio tab). Verify:
  `/verify/record` (public) — offline check against the embedded key plus a
  best-effort live cross-check of the issuer's well-known key (three
  outcomes surfaced: confirmed / mismatch warning / issuer unreachable).
- Import/merge and key rotation: ROADMAP.

## Governance surfaces

- **Equity lens** (`lib/equity.ts`, Audit → Equity tab): attendance by
  grade, worst-first, small-cohort flags, gap warning at ≥25pp, CSV export.
  Aggregates cohorts only — never individual rankings (service-not-
  assessment ethic). Rota-group version: ROADMAP.
- **Compliance pack**: `docs/compliance/dtac.md`,
  `docs/compliance/dpia-template.md`.

## Project mechanics

- Playwright smoke (`e2e/`, port 3100, placeholder env — public surface
  only; DB-touching pages are out of scope until authed e2e infra exists).
- `scripts/seed-demo.mjs` (guarded against non-empty databases).
- ROADMAP.md is the honest list of what's deliberately not built yet.
