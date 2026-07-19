# 09 — Public API, webhooks, federation, providers, and self-hosting

## Scope

This document specifies four external boundaries:

1. the organization-scoped bearer REST API at `/api/v1`;
2. signed outbound webhooks;
3. user-initiated portable teaching-record federation; and
4. deployment/provider configuration for a self-hosted instance.

All `/api/*` paths bypass the browser-auth proxy. Every handler owns its auth
contract. The supported API schema is also published at `public/openapi.json` and
explained in `docs/api.md`; changes must keep all three descriptions aligned.

## API credentials

Only a super/organization admin—not a department admin—can manage API tokens in
Settings.

Creation:

1. trim and cap token name at 100 characters;
2. filter requested values to the supported scope allow-list and require at
   least one;
3. generate 24 random bytes as 48 lowercase hex characters with `pt_` prefix;
4. store SHA-256 of the complete token, plus display prefix such as `pt_abcd…`;
5. return plaintext once; and
6. record creator/time.

Authentication requires an exact case-insensitive Bearer pattern for
`pt_<48 hex>`, hashes the presented token, resolves a nonrevoked row, checks the
route scope, and derives `orgId` only from that row. `last_used_at` is updated
best-effort and never fails the API request.

Revocation writes `revoked_at`; there is no un-revoke, expiry, IP restriction,
per-token rate limit, or key rotation endpoint. A replacement is a new token.
Database compromise does not reveal live API plaintext, but a leaked one-time
value remains valid until revoked.

Supported scopes:

- `read:sessions`
- `write:sessions`
- `read:attendance`
- `read:certificates`
- `read:departments`
- `read:slots`

## Response and error envelope

Successful collection/single responses use `{ "data": ... }`. Explicit API
errors use:

```json
{ "error": "Human-readable message", "code": "stable_machine_code" }
```

Token failures are 401, scope failure 403, missing scoped records 404, and
validation/state failures generally 400. Uncaught DAL/runtime errors can still
fall through to the framework's generic 500 response, so “every possible error
has the envelope” is not an implemented guarantee.

There is no API-level request id, idempotency key, cursor pagination, ETag,
conditional write, or built-in rate limiting. Operators should apply reverse-
proxy rate/size limits for untrusted integrations.

## REST endpoint contract

### `GET /api/v1/sessions` — `read:sessions`

Returns up to 100 sessions in the token organization, ordered by `date_start`
ascending. Optional filters:

- `from`: `date_start >= value`;
- `to`: `date_start <= value`;
- `department_id`: exact department; and
- `status`: exact stored status.

The handler does not expose its DAL `limit` option and does not validate filter
syntax/status beyond forwarding the strings. The OpenAPI document advertises ISO
date-time and known statuses; malformed values may produce a database/framework
error rather than a neat 400.

Serialized session fields are stable v1 contract:

- id and department id;
- title and nullable description;
- start/end;
- location type and resolved `meeting_url`;
- status and nullable session type; and
- created/updated timestamps.

`org_id`, creator, attendance settings, reminder/report watermarks, and internal
join data are omitted.

### `POST /api/v1/sessions` — `write:sessions`

Requires JSON `department_id`, `title`, `date_start`, `date_end`, and
`location_type`; description is optional. It:

- validates location as `MS_TEAMS`, `IN_PERSON`, `HYBRID`, or `JITSI`;
- validates parseable dates and end strictly after start;
- verifies the department belongs to the token organization;
- truncates title to 300 and description to 5,000 characters;
- creates status `DRAFT`; and
- attributes `created_by` to the department's creator because a token has no
  auth user.

The route cannot set session type, meeting URL, status, teacher, tags, or
attendance configuration. It applies no 30–240-minute duration bound.

### `GET /api/v1/sessions/:id` — `read:sessions`

Returns the serialized row only when `sessions.org_id` matches the token.

### `POST /api/v1/sessions/:id/publish` — `write:sessions`

Loads the org-scoped session. Already published returns the existing row without
another event. Otherwise it blocks when session end is at/before now, writes
`PUBLISHED`, and fire-and-forget emits `session.published`. It does not require
the previous status to be `DRAFT`, so a future, nonended `CANCELLED` session can
be published through this route.

### `GET /api/v1/sessions/:id/attendance` — `read:attendance`

First verifies the session belongs to the token organization, then returns every
materialized row:

- `user_id` or `external_email`;
- `status`;
- `primary_source`; and
- `first_evidence_at` (the selected primary-evidence timestamp).

This is personal data, not an anonymized aggregate scope. It omits raw evidence,
metadata, computed time, and lock fields. Missing expected members do not appear
as synthesized ABSENT rows.

### `GET /api/v1/departments` — `read:departments`

Returns every organization department ordered by name with id, name, and
`department_code`. The code is an onboarding credential and makes this scope
sensitive even though the endpoint is read-only.

### `GET /api/v1/slots` — `read:slots`

Returns every organization slot whose status is `OPEN` and `date_start > now`,
ordered ascending, with id, department, start/end, location, and status. It does
not filter to slots published/offered to a particular audience.

### `GET /api/v1/certificates/:code` — `read:certificates`

Looks up the globally unique code, then returns 404 unless the certificate
organization matches the token. Response includes code, role,
`recognition_basis` (`LIVE_ATTENDANCE`, `AUDIO_RECAP_CATCH_UP`, or
`TEACHING_ASSIGNMENT`), recipient name, ordered snapshotted
`teaching_coordinators`, issued time,
session id/title/date, department id/name, lifecycle `status`, revocation fields,
and `valid`. Only status `VALID` returns `valid: true`;
`LEGACY` and `REVOKED` remain resolvable audit states rather than false “not
found” responses.

## Webhook administration

Only super/organization admins manage webhooks. Creation requires at least one
supported event and a URL accepted by `isBlockedWebhookUrl`. The service creates
`whsec_` plus 24 random bytes as hex and stores the secret plaintext because it
must sign future requests. Full secret is returned once; list views expose a
short hint. Endpoints can be enabled/disabled or deleted.

Supported events:

- `session.published`
- `attendance.computed`
- `certificate.issued`
- `slot.claimed`

## Webhook envelope and signature

Each active endpoint subscribed to the event receives one POST:

```json
{
  "event": "session.published",
  "created_at": "2026-07-13T12:00:00.000Z",
  "data": {}
}
```

Headers:

- `Content-Type: application/json`
- `X-Petrios-Event: <event>`
- `X-Petrios-Signature: sha256=<lowercase hex HMAC-SHA256>`

The HMAC is keyed by the endpoint secret and covers the exact raw JSON body.
Consumers must verify raw bytes before parsing and use constant-time comparison.
There is no timestamp header/replay window or delivery id in the envelope;
consumer idempotency must derive from payload identifiers plus event semantics.

### Event producers and payloads

| Event | Emitted by current code | Data |
|---|---|---|
| `session.published` | Interactive nonpublished→published transition and bearer API publish | session id/title, department id, start/end |
| `attendance.computed` | Post-session report job only | session id |
| `certificate.issued` | Post-session report job and Audio Recap catch-up award worker, for a newly inserted attendee cert | session id, code, `ATTENDEE` role; catch-up producer also includes recognition basis |
| `slot.claimed` | Successful slot orchestration | slot id, generated session id, department id, start |

Other attendance recomputations and manual/batch certificate issue paths do not
currently emit their nominal events. Consumers must not assume
`certificate.issued` is a complete audit stream.

## Delivery semantics and SSRF boundary

`emitWebhook` is deliberately fire-and-forget at call sites and catches all
top-level failures. It loads active subscribed endpoints, serializes one body,
and uses `Promise.allSettled` for endpoints. Each request has a five-second
timeout.

There is exactly one attempt. A delivery row stores endpoint, event, inner data
payload, `ok`/`failed`, HTTP response code, attempts (default one), and timestamp.
Response bodies are not retained. No retry/backoff/dead-letter worker is shipped.
An initiating action never rolls back or waits for guaranteed webhook success.

URL validation always requires `http` or `https`. In production it blocks
literal localhost, `.local`, loopback, link-local, and RFC1918 IPv4 patterns plus
literal `::1`. Nonproduction intentionally allows local listeners.

Current SSRF limitations:

- production still permits plaintext `http`;
- hostnames are not DNS-resolved before/after connect, so DNS rebinding and a
  public hostname resolving to private space are not prevented;
- most private/nonroutable IPv6 ranges and alternative IP encodings are not
  covered; and
- redirects rely on platform `fetch` behavior and are not revalidated per hop.

The guard is best-effort, not a complete egress firewall. Production deployments
should also restrict network egress and resolve/connect safely before claiming
robust SSRF protection.

## Portable teaching-record federation

Federation is user-initiated export and public paste-to-verify. It does not push
records to another instance, create a central registry, or import them into a
user profile.

### Instance identity

`scripts/generate-instance-key.mjs` generates Ed25519 keys. The server stores
`INSTANCE_SIGNING_KEY` as base64 PKCS#8 DER private key. The corresponding SPKI
DER public key is derived at runtime.

When configured, `GET /.well-known/petrios` returns:

- `software: "bytes-teaching"` (legacy product identifier);
- `record_format: "petrios-record/v1"`;
- configured instance URL;
- public key; and
- public paste-verification URL.

When unconfigured it returns 404. There is no key id, previous-key list, rotation
metadata, revocation list, or trust directory.

### Record shape and personal data

An authenticated user exports their current progress record as JSON containing:

- format, issuer URL, issued timestamp, embedded public key;
- full display name and profile grade;
- **all live expected attendance entries**, including absences, with
  session title/date/status/source;
- all current organization certificate codes; and
- signature.

Legacy `petrios-record/v1` exports may contain a `coverage` object. Verification
continues to accept and sign-check that optional field, but new exports omit it.

This is explicitly identifiable personal data. Export is the user's disclosure
action; no background federation transfer occurs.

### Canonicalization and signing

The signature covers the object without `signature`. `canonicalize`:

- recursively sorts object keys lexically;
- removes object properties whose value is `undefined`;
- preserves array order; and
- emits JSON without whitespace.

Node signs the canonical UTF-8 bytes with Ed25519 and returns base64 signature.
Formatting/whitespace in the exported JSON is irrelevant to verification.

### Verification levels

The public action parses JSON, requires exact format plus signature/public key,
and verifies the signature against the **embedded** key. It then best-effort
fetches `<record.issuer>/.well-known/petrios` with a five-second timeout and
compares the live public key.

Results distinguish:

- signature valid and issuer key confirmed (`issuerKeyConfirmed = true`);
- signature valid but live key differs (`false`); and
- signature valid but issuer could not be fetched (`null`).

`valid` remains true in all three cases once the embedded-key signature passes.
An embedded key alone proves internal consistency/tamper resistance, not that a
trusted Petrios instance issued the record—anyone can generate a key and sign
their own object. Trust requires an independently trusted issuer/key.

Current verification limitations:

- only format/signature/key presence is checked; the rest of the record is not
  schema-validated before optional display;
- no key rotation/history means a legitimate old record can show a key mismatch;
- there is no record revocation, expiry, nonce, or online issuance lookup;
- subject/session/certificate claims are not cross-checked with issuer APIs; and
- the verifier server fetches a user-controlled `issuer` URL without the webhook
  SSRF guard. A correctly self-signed malicious record can trigger requests to
  internal addresses. This is a high-priority egress/validation limitation.

Do not use paste verification on untrusted records in a network with sensitive
internal services until issuer URL validation and egress controls are hardened.

## Federated benchmarking boundary

`petrios-benchmark/v1` in spec 10 is an RFC only. No current route advertises,
serves, fetches, stores, or compares benchmark documents. Do not add
`benchmark_url` to well-known metadata without implementing the full opt-in,
suppression, signature, and SSRF contract.

## Provider adapters

### Application URL

`getAppUrl()` selects the first valid origin in this order:

1. `NEXT_PUBLIC_APP_URL`
2. `NEXT_PUBLIC_BASE_URL` (legacy)
3. `NEXTAUTH_URL` (URL fallback only; Petrios does not otherwise use NextAuth)
4. `VERCEL_PROJECT_PRODUCTION_URL`
5. `VERCEL_URL`
6. `RENDER_EXTERNAL_URL`

Values without protocol use HTTPS unless localhost/loopback. Paths are reduced to
origin. Production rejects missing or local URLs; development falls back to
`http://localhost:3000`. `getAppUrlFromHeaders` can use forwarded host/proto when
no environment URL exists.

Some older call sites still directly read `NEXT_PUBLIC_APP_URL` or
`NEXT_PUBLIC_BASE_URL` and fall back to localhost. New code should use the helper;
removing legacy behavior requires testing every emailed/QR/callback URL.

### Email

SMTP takes precedence over Resend; development can use a log sink. Sender,
redirect, attachment, error-return, and HTML-safety semantics are specified in
spec 07.

### LLM

`lib/ai/llm.ts` calls `<OPENAI_BASE_URL>/chat/completions` for ordinary text
inference and `<OPENAI_BASE_URL>/responses` for Audio Recap document input plus
hosted research, defaulting to the OpenAI API with Bearer `OPENAI_API_KEY`.
`OPENAI_MODEL` defaults to `gpt-5.5`. Chat uses `max_completion_tokens`, optional
`reasoning_effort`, and optional JSON object response format.

The recap path uses `instructions`, `max_output_tokens`, Base64 data-URL
`input_file` parts, and a final `input_text`. When research is requested it adds
a `web_search` tool with `external_web_access: true`, `search_context_size`, an
authoritative `filters.allowed_domains` list, and approximate GB user location.
Because research is a product requirement rather than an optional model choice,
the request sets `tool_choice: required`. It requests
`web_search_call.action.sources` in `include` and collects sources from both that
tool item and output-text `url_citation` annotations. Only HTTP(S) URLs survive;
URLs are normalized/de-duplicated and capped at 20 before persistence.

File fingerprints and the static research configuration contribute to the Ops
prompt hash. Raw document bytes, prompt text, provider-generated search queries,
and fetched public-page bodies are not written to the Ops audit. The provider may
still process or retain those values according to its own service terms. No key
returns null; HTTP failure, refusal, incomplete output, or missing required
research sources fails generation safely. An OpenAI-compatible custom base URL
must support both endpoint shapes plus Responses file inputs, the hosted
`web_search` request fields, and source-bearing response items for the full
feature set. Chat Completions or file-input compatibility alone is insufficient.
The request shapes follow the official [file-input guide](https://developers.openai.com/api/docs/guides/file-inputs)
and [web-search guide](https://developers.openai.com/api/docs/guides/tools-web-search);
operators of custom endpoints must verify equivalent semantics rather than only
matching the URL paths.

### Speech

`lib/ai/tts.ts` is the only sanctioned speech boundary. It returns MP3 bytes plus
the exact public-safe provider, model, and voice metadata to persist with the
artifact. Callers do not read provider environment variables or construct
provider requests themselves.

Provider selection is deterministic:

1. a valid `TTS_PROVIDER=openai|elevenlabs` pins that provider;
2. otherwise the presence of either `ELEVENLABS_API_KEY` or
   `ELEVENLABS_VOICE_ID` selects ElevenLabs, making a partially configured setup
   visible as an error instead of silently falling back; and
3. otherwise OpenAI remains the historical default.

OpenAI speech posts JSON to `<OPENAI_BASE_URL>/audio/speech` with Bearer
`OPENAI_API_KEY`, `input`, `model`, `voice`, and `response_format: mp3`.
`OPENAI_TTS_MODEL` defaults to `gpt-4o-mini-tts` and `OPENAI_TTS_VOICE` to
`alloy`. A missing key returns null without network activity. A 404 from a custom
compatible endpoint also returns null because that endpoint may support LLM but
not speech; every other non-2xx response throws.

ElevenLabs speech posts JSON containing `text` and `model_id` to
`https://api.elevenlabs.io/v1/text-to-speech/:voice_id`, authenticated by the
`xi-api-key` header, with `output_format=mp3_44100_128`. Both
`ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` are required;
`ELEVENLABS_MODEL_ID` defaults to `eleven_multilingual_v2`. The API origin and
output encoding are fixed rather than operator-overridable so an ElevenLabs
selection cannot silently disclose text to an arbitrary host. Non-2xx responses
throw and no false audio success is stored.

For Audio Recaps, the speech request contains only the current stored draft
script. Uploaded document bytes/extracted content, hosted-search queries, public
page bodies, research citations, raw feedback, actor identity, session id, and
organization id are not added by the adapter. The separate LLM/document/research
flow remains described above. Every create/re-create request can consume provider
credits and the management UI warns accordingly.

The generated recap target (650–800 words) is chosen to fit both the OpenAI
default model's 2,000-token input budget and ElevenLabs' documented 10,000-
character limit for `eleven_multilingual_v2`; the application independently caps
stored scripts at 7,000 characters. Characters are not an exact OpenAI token
count, so custom/manual text can still receive a provider validation error. The
adapter never truncates a moderator-approved script. See the official
[`gpt-4o-mini-tts` model reference](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
and [ElevenLabs text-to-speech reference](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).

### Meetings

`NEXT_PUBLIC_JITSI_DOMAIN` defaults to `meet.jit.si`; Petrios derives session
room URLs and does not configure provider authentication.

## Deployment architecture

The Docker image contains only the stateless Next.js standalone server. It uses
Node 22 Alpine, runs as a nonroot user, includes `.next/static` and `public/`
(required for PDF fonts/assets), listens on port 3000, and runs an HTTP
healthcheck.

`docker-compose.yml` builds that app and loads `.env.production`. It does not run
Postgres, GoTrue, storage, SMTP, Jitsi, or an AI provider.

Despite the generic `DATABASE_URL` migration connection, the schema is
**Supabase-specific**: migrations and RLS reference `auth.users`, `auth.uid()`,
GoTrue metadata, and Supabase helper behavior. A vanilla Postgres server without
the compatible auth schema/functions is not a complete Petrios backend. Deploy
against hosted Supabase or a self-hosted Supabase-compatible stack.

## Migration runner and upgrades

`npm run db:migrate`:

- requires `DATABASE_URL`;
- creates `public._bytes_migrations`;
- sorts all `.sql` filenames lexically;
- skips filenames already recorded;
- applies each normal migration in its own transaction; and
- applies files containing `ALTER TYPE ... ADD VALUE` outside an explicit
  transaction, then records them.

The tracking table records only this runner. Supabase CLI history is separate;
mixing tools without reconciliation can cause the runner to attempt migrations
already applied by another mechanism. Back up, choose an upgrade procedure, and
test on a restore.

All durable application state—including stored audio recap bytes—is currently in
Postgres. Backups must include database/schema/auth state. Containers are
disposable. External email/webhook provider logs are not part of that backup.

## Health

`GET /api/health` is public and force-dynamic. It reports only process/database
reachability:

- 200 `{ "status": "ok", "db": "ok" }`; or
- 503 `{ "status": "degraded", "db": "error" }`.

It does not check migrations, Auth, email, AI, TTS, Jitsi, cron freshness,
webhook delivery, disk/connection capacity, or signing-key correctness.

## Environment contract

| Variable | Required / default | Purpose and sensitivity |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Browser/server Supabase base URL; public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | RLS-constrained browser key; public but not authorization by itself |
| `SUPABASE_SERVICE_ROLE_KEY` | Required server-side | RLS bypass, GoTrue admin, Recall/other HMAC secret; critical secret |
| `NEXT_PUBLIC_APP_URL` | Required in production by helper | Canonical public origin for links/federation |
| `NEXT_PUBLIC_BASE_URL` | Legacy fallback | Older URL construction |
| `NEXTAUTH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `RENDER_EXTERNAL_URL` | Optional fallback | App-origin discovery |
| `MAIL_FROM` | Required for production mail | Display/sender address; bare addresses receive the Petrios display name and old Byte/Bytes Teaching names are normalized |
| `RESEND_FROM_EMAIL` | Legacy fallback | Sender address with the same display-name normalization |
| `SMTP_HOST` | Optional; takes priority | Select SMTP transport |
| `SMTP_PORT` | Default 587 | SMTP port |
| `SMTP_SECURE` | `true` only for implicit TLS | SMTP transport mode |
| `SMTP_USER`, `SMTP_PASS` | Optional relay auth | Server secrets |
| `RESEND_API_KEY` | Required if Resend is selected | Server secret |
| `MAIL_DEV_REDIRECT` | Optional | Redirect every recipient to one inbox |
| `CRON_SECRET` | Required to run jobs | Shared Bearer secret; no query fallback |
| `ATTENDANCE_RATE_LIMIT_SECRET` | Optional HMAC key pseudonymizing check-in IPs for rate limiting; falls back to the service-role key |
| `OPENAI_API_KEY` | Optional | Enables LLM and default OpenAI speech; server secret |
| `OPENAI_BASE_URL` | Default OpenAI v1 | Compatible internal/gateway/provider base |
| `OPENAI_MODEL` | Default `gpt-5.5` | Chat model |
| `TTS_PROVIDER` | Optional `openai` or `elevenlabs` | Explicit speech-provider pin; invalid values disable speech with a configuration error |
| `ELEVENLABS_API_KEY` | Required when ElevenLabs selected | Speech API credential; server secret |
| `ELEVENLABS_VOICE_ID` | Required when ElevenLabs selected | Voice selected for new Audio Recap MP3 generation |
| `ELEVENLABS_MODEL_ID` | Default `eleven_multilingual_v2` | ElevenLabs speech model |
| `OPENAI_TTS_MODEL` | Default `gpt-4o-mini-tts` | Speech model |
| `OPENAI_TTS_VOICE` | Default `alloy` | Speech voice |
| `OPS_ENABLED` | Disabled only by exact `false` | Ops execution kill switch |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Default `meet.jit.si` | Browser-visible meeting host |
| `INSTANCE_SIGNING_KEY` | Optional | Ed25519 PKCS#8 DER base64 private key; critical secret |
| `DATABASE_URL` | Migration runner only | Direct database credential |
| `GOOGLE_SITE_VERIFICATION` | Optional | Search Console meta content |
| `PRIVACY_CONTROLLER_NAME` | Required production disclosure | Public controller legal name |
| `PRIVACY_CONTROLLER_ADDRESS` | Required production disclosure | Public controller postal/service address |
| `PRIVACY_CONTACT_EMAIL` | Required production disclosure | Public monitored privacy/DPO inbox |
| `DATA_HOSTING_REGION` | Required production disclosure | Accurate application/database/backup region summary |
| `DATA_TRANSFER_SAFEGUARDS` | Required where relevant | Public reviewed transfer-mechanism summary |

`NODE_ENV`, `CI`, and hosting-provided variables also influence diagnostics and
test/development behavior. Only `NEXT_PUBLIC_*` variables may be intentionally
bundled into browser code.

Current `.env.example` limitation: it does not enumerate every optional/legacy
variable above. Treat this table plus source as the current behavior until the
example is synchronized.

Compliance pages read their server-only public disclosure variables at request
time and render an explicit missing state instead of inventing facts. Provider
status is derived from deployment variables without exposing credentials or a
custom internal AI endpoint. The complete public disclosure and browser-header
contract is in spec 13.

## External-boundary change checklist

- API token org/scope remains the only tenant source.
- OpenAPI, docs, serializers, routes, and this spec change together.
- New list endpoints have pagination/rate/PII posture.
- Webhook signature covers raw body and payload is version-compatible.
- Event production completeness is stated; side effects remain nonblocking.
- URL inputs are protected against DNS, redirect, IPv4/IPv6, and cloud-metadata
  SSRF, with network egress defense in depth.
- Portable records are schema-validated and trust level is not confused with
  embedded-key consistency.
- Key rotation/revocation/backward verification is designed before rotating a
  production federation identity.
- Self-host instructions retain Supabase auth requirements.
- Every environment secret stays server-only and production URL/mail failures are
  explicit.
