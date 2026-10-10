# 09 — Public API, webhooks, federation, providers, and self-hosting

## Scope

This document specifies four external boundaries:

1. the organization-scoped bearer REST API at `/api/v1`;
2. signed outbound webhooks;
3. user-initiated portable teaching-record federation; and
4. deployment/provider configuration for a self-hosted instance, the Render
   Docker image, and the Cloudflare Workers staging and production builds.

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
best-effort after the response (registered with `after()`), so it never fails
or delays the API request. Bearer authentication is therefore callable only
from route handlers.

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
- location type and resolved `meeting_url` (`sessionMeetingUrl` with the
  member audience: the stored Teams link for Teams/hybrid; for `JITSI` the
  Petrios session page URL in every video mode (without a configured public app
  URL: the raw meet.jit.si / open self-hosted room, else null; the serializer
  never throws); null in person);
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
`PUBLISHED`, and emits `session.published` after the response via `after()`. It
does not require the previous status to be `DRAFT`, so a future, nonended
`CANCELLED` session can be published through this route.

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
supported event and a URL accepted by `isBlockedWebhookUrl` (see "Delivery
semantics and SSRF boundary"; the check applies in every environment unless
`WEBHOOK_ALLOW_PRIVATE=true`). The service creates
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
| `attendance.computed` | Post-session report job only, once per pass over an unwatermarked finalized session (repeats when delivery spans runs or retries) | session id |
| `certificate.issued` | Post-session report job and Audio Recap catch-up award worker, for a newly inserted attendee cert | session id, code, `ATTENDEE` role; catch-up producer also includes recognition basis |
| `slot.claimed` | Successful slot orchestration | slot id, generated session id, department id, start |

Other attendance recomputations and manual/batch certificate issue paths do not
currently emit their nominal events. Consumers must not assume
`certificate.issued` is a complete audit stream.

## Delivery semantics and SSRF boundary

`emitWebhook` never rejects: it catches all top-level failures. Request paths
(the session publish server action, the bearer publish route, and slot claim)
register it with `after(() => emitWebhook(...))` from `next/server`, so it runs
after the response without slowing it; on Workers OpenNext maps `after()` to
`waitUntil`, and on the Node server it runs in-process. The post-session job and
the catch-up award worker await it, so a job finishes its work before
responding. No call site leaves it as a floating promise, because Workers may
cancel unregistered work after the response. It loads active subscribed
endpoints, serializes one body, and uses `Promise.allSettled` for endpoints.
Each request has a five-second timeout.

There is exactly one attempt. A delivery row stores endpoint, event, inner data
payload, `ok`/`failed`, HTTP response code, attempts (default one), and timestamp.
Response bodies are not retained. No retry/backoff/dead-letter worker is shipped.
An initiating action never rolls back or waits for guaranteed webhook success;
the catch-up award worker (also reached from the Recall answer action) waits for
the single attempt but never fails on it.

The same guard (`lib/webhook-guard.ts`, re-exported from `lib/webhooks.ts`)
runs at registration and again before every delivery, **in every
environment** — `NODE_ENV` no longer matters. It rejects:

- any scheme other than `http`/`https`, and URLs carrying credentials;
- single-label hosts (compose service names such as `db`, `auth`, `rest`,
  `storage`, `gateway`, `app`) and special-use suffixes (`localhost`, `.local`,
  `.localdomain`, `.internal`, `.intranet`, `.private`, `.corp`, `.home`,
  `.lan`, `.arpa` incl. `home.arpa`, `.test`, `.example`, `.invalid`,
  `.onion`), with trailing dots ignored;
- IPv4 outside public unicast: `0/8`, `10/8`, `100.64/10`, `127/8`,
  `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`,
  `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`,
  `240/4` (WHATWG URL parsing has already normalised `http://0/`,
  `0x7f.1`, `2130706433` and octal forms to dotted quads); and
- IPv6 outside global unicast `2000::/3` (so `::`, `::1`, `fc00::/7`,
  `fe80::/10`, `fec0::/10`, `ff00::/8`, `100::/64`, `64:ff9b:1::/48`), plus
  `2001::/23` and `2001:db8::/32`; IPv4-mapped `::ffff:0:0/96`, NAT64
  `64:ff9b::/96` and 6to4 `2002::/16` are judged by their embedded IPv4.
  Brackets are stripped before parsing; scoped addresses are rejected.

Delivery transport:

- **Node (Render, self-host):** `node:http(s)` with a guarded `lookup`. It
  resolves the host (`dns.lookup`, all addresses), rejects the delivery when
  any address is non-public or none resolve, and hands the socket only the
  checked addresses, so the connection goes to an address that passed the
  check (no rebinding gap). Each delivery uses a fresh connection
  (`agent: false`). Redirects are never followed; a 3xx is recorded as
  `failed` with its status.
- **Workers:** `fetch` with `redirect: 'manual'` (a 3xx is `failed`); the
  Worker's `global_fetch_strictly_public` compatibility flag restricts egress
  to public addresses, and the URL guard above still runs first.

A blocked or unresolvable destination is stored as `failed` with a null
response code; no request is sent.

`WEBHOOK_ALLOW_PRIVATE=true` (exactly) disables the destination checks — for
local development against `localhost` listeners or an in-network consumer a
self-hoster trusts. Scheme and credential checks still apply. It is unset on
every hosted deployment.

Remaining limitations:

- plaintext `http` is still permitted for public hosts;
- the stored response code of a public endpoint is shown to org admins; and
- on Workers the private-egress boundary is the platform flag, not an
  in-process DNS check.

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

1. `APP_URL`
2. `NEXT_PUBLIC_APP_URL`
3. `NEXT_PUBLIC_BASE_URL` (legacy)
4. `NEXTAUTH_URL` (URL fallback only; Petrios does not otherwise use NextAuth)
5. `VERCEL_PROJECT_PRODUCTION_URL`
6. `VERCEL_URL`
7. `RENDER_EXTERNAL_URL`

Values without protocol use HTTPS unless localhost/loopback. Paths are reduced to
origin. Production rejects missing or local URLs; development falls back to
`http://localhost:3000`. `getAppUrlFromHeaders` can use forwarded host/proto when
no environment URL exists.

The helper reads these names indirectly at request time, so they are never
inlined into a build. No call site reads a `NEXT_PUBLIC_*` URL variable
directly; the certificate preview/download routes use `getAppUrlFromHeaders()`.
New code must use the helpers, because a literal `process.env.NEXT_PUBLIC_*`
read is fixed at build time from the build machine's environment.

### Email

SMTP takes precedence over Resend; development can use a log sink. Sender,
redirect, attachment, error-return, and HTML-safety semantics are specified in
spec 07.

### LLM

Provider resolution lives in `lib/ai/provider.ts` (`resolveLlmProvider`):
`LLM_PROVIDER=anthropic|openai` pins the provider (a pinned provider without
its key stays unconfigured; any other value disables AI with a configuration
error); with no pin, `ANTHROPIC_API_KEY` + `OPENAI_API_KEY` + `OPENAI_BASE_URL`
is a configuration error (AI off — a custom OpenAI-compatible endpoint is a data
residency signal, so a second key must not silently redirect traffic); otherwise
`ANTHROPIC_API_KEY` selects Anthropic and `OPENAI_API_KEY` the OpenAI-compatible
adapter. With both keys and no pin the choice (or error) is logged once.
`lib/ai/llm.ts` dispatches every call; null means unconfigured.

#### Anthropic (default)

The official `@anthropic-ai/sdk` (pinned 0.132.1) client is built once per
process/isolate with the API key passed explicitly (no profile/credential-file
discovery, no `ANTHROPIC_AUTH_TOKEN`), log level pinned to `warn`, a 5-minute
per-attempt timeout, 2 SDK retries, and `cache: 'no-store'`. `ANTHROPIC_MODEL`
defaults to `claude-opus-5-5`; `ANTHROPIC_BASE_URL` selects a gateway.

Every model call streams `client.beta.messages.stream(...).finalMessage()` with
`fallbacks: 'default'` and beta `server-side-fallback-2026-07-01`
(`ANTHROPIC_FALLBACKS=off` removes both). `thinking` is never sent (adaptive and
always on); effort is explicit in `output_config.effort` per purpose (spec 06);
`max_tokens = min(64000, max(requested, floor))` with floors 8,192/16,384/32,768
for low/medium/high. No sampling parameters, prefill or forced `tool_choice`.
File-backed and assistant calls set top-level `cache_control: ephemeral`.
`end_turn` returns the text; `refusal`, `max_tokens`,
`model_context_window_exceeded` and unexpected `tool_use` throw; `pause_turn`
(server tools) resumes with the same tools and the echoed content, at most 5
times. After a mid-output refusal fallback, echoed content omits the declined
attempt's thinking/tool_use and unpaired server_tool_use blocks. Token counts
include cache reads/writes and sum `usage.iterations` when present; the result
reports the serving model.

Documents (Audio Recap, newsletter) go through the Files API, one at a time:
a streamed multipart `POST /v1/files` via `client.post` (the SDK's
`files.upload()` buffers the whole file) with `expires_in_seconds=3600` and an
opaque `petrios-ai-<uuid>.pdf|.txt` filename, `redirect: 'error'` (Node) /
`'manual'` (Workers) and `cache: 'no-store'`. PDFs upload their verified bytes;
DOCX/PPTX upload extracted UTF-8 text (`lib/ai/office-text.ts`: two bounded
streaming passes over the stored object — the ZIP central directory from a
~1.1 MiB tail, then each wanted part inflated through
`DecompressionStream('deflate-raw')` into a streaming XML scanner; at most
1,000,000 characters, 64 MiB inflated, 2,000 slides; structure parts ≤2 MiB are
scanned for slide order and notes relationships only; nothing is inflated after
the character budget is spent; text is accepted only after the size/SHA-256
check). One retry on 429/5xx/connection errors re-opens the source; a source
(storage/integrity) failure is never retried and any file the endpoint accepted
from a failed body is deleted. Each attempt releases its source when it ends.
The Messages request references `{type: 'document', source: {type: 'file',
file_id}, title}` blocks before the prompt (Office text adds a `context` note).
Every uploaded id is deleted in `finally` (`Promise.allSettled`, 30 s timeout,
404 counts as deleted); the `ops-synthesis` cron sweeps `petrios-ai-` files
older than 2 hours on every run. Files are workspace-scoped: use a dedicated
workspace and key. A 400 on a document request (600-page/context limits, an
unreadable file, web search disabled for the workspace) maps to a
provider-neutral message.

Research adds `web_search_20260209` (`allowed_callers: ['direct']`, the
allow-list, `max_uses` 6, approximate GB location) and a fixed instruction to
search before writing; the caller requires at least one completed search
(usage counter or paired result blocks, whichever is larger) and one
allow-listed source. The answer is the text after the last tool result.
Sources: citations first, then results; allow-listed HTTP(S) hosts only,
normalized, de-duplicated, at most 20; `cited_text`/encrypted fields never kept.
In-band search error codes are logged as codes only.

Errors are typed SDK errors. Logs/audit carry class, status, request id and API
error type; a non-HTTP SDK error (unreadable stream, unparseable tool input) is
reported only as `unreadable_response`.

#### OpenAI-compatible adapter (optional)

The adapter calls `<OPENAI_BASE_URL>/chat/completions` for ordinary text
inference and `<OPENAI_BASE_URL>/responses` for document input (Audio Recap
with hosted research, and the department newsletter), defaulting to the OpenAI
API with Bearer `OPENAI_API_KEY`.
`OPENAI_MODEL` defaults to `gpt-5.5`. Chat uses `max_completion_tokens`, optional
`reasoning_effort`, and optional JSON object response format.

The file-input path uses `instructions`, `max_output_tokens`, `store: false`,
Base64 data-URL `input_file` parts, and a final `input_text`. The Responses
API otherwise stores the response and its input items (here the documents) as
retrievable application state; Petrios never reads a response back and sends
no `previous_response_id`, so it opts out. `store: false` does not change the
provider's separate abuse-monitoring retention (spec 13). That body is streamed rather than
built in memory (`lib/ai/streaming-body.ts`): the non-file JSON comes from one
`JSON.stringify` call with a placeholder per file, and each document's data URL
is base64-encoded in pieces from its storage stream while the request uploads,
byte-identical to a fully serialized body. Extra memory is a few chunks per
request whatever the document size (measured on Node 24: about 4 MiB of live
buffers for a 50 MiB source set, versus about 183 MiB when buffered). The
request uses chunked transfer encoding (`duplex: 'half'`) and `cache: 'no-store'`
(so a production build never reads the body to build a fetch-cache key; the
`next dev` HMR cache still does), and refuses
redirects: `redirect: 'error'` on Node, whose fetch otherwise keeps a copy of a
streamed body for redirect replay, and `'manual'` on Workers, which reject
`'error'` (a 3xx then fails as non-2xx). Each call re-opens the documents, so
the gateway's retry starts from scratch, and a failed or aborted request cancels
the storage read in progress. When research is requested it adds
a `web_search` tool with `external_web_access: true`, `search_context_size`, an
authoritative `filters.allowed_domains` list, and approximate GB user location.
Because research is a product requirement rather than an optional model choice,
the request sets `tool_choice: required`. It requests
`web_search_call.action.sources` in `include` and collects sources from both that
tool item and output-text `url_citation` annotations. Only HTTP(S) URLs survive;
URLs are normalized/de-duplicated and capped at 20 before persistence.

File fingerprints (provider filename plus the stored `session_documents.sha256`,
never file bytes) and the static research configuration contribute to the Ops
prompt hash. Raw document bytes, prompt text, provider-generated search queries,
and fetched public-page bodies are not written to the Ops audit. The provider may
still process or retain those values according to its own service terms. No key
returns null; HTTP failure, refusal, incomplete output, or missing required
research sources fails generation safely. On the adapter, an OpenAI-compatible custom base URL
must support both endpoint shapes plus Responses file inputs sent as a chunked
(streamed) request body at the configured URL without redirects, the hosted
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
3. otherwise `OPENAI_API_KEY` selects OpenAI (the historical default); with none of these, speech is unconfigured. The LLM provider never selects speech.

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

Petrios Meet resolves one of three modes from server environment at request
time (`lib/meeting/config.ts`; full contract in spec 04 "Petrios Meet"):

- **JaaS** (recommended for production): set `JAAS_APP_ID`, `JAAS_API_KEY_ID`
  and `JAAS_PRIVATE_KEY`. Rooms are embedded from `8x8.vc` and every participant
  joins with an RS256 room pass minted by Petrios (WebCrypto; PKCS#8 or PKCS#1
  PEM, literal `\n` escapes accepted). Setup: create an app in the JaaS console
  (jaas.8x8.vc), generate or upload an API key, copy the AppID and the key id
  (it starts with `<AppID>/`), and store the private key as a server secret.
  8x8 is then a subprocessor (spec 13). Step-by-step operator guide (JaaS
  console, Render, Workers, verification, rollout): `docs/petrios-meet.md`.
- **Self-hosted**: set `JITSI_DOMAIN` to your Jitsi host (optionally `:port`).
  Rooms are embedded from that origin. With `JITSI_APP_ID` + `JITSI_APP_SECRET`
  (Prosody token auth, HS256; docker-jitsi-meet `ENABLE_AUTH=1`,
  `AUTH_TYPE=jwt`, `JWT_APP_ID`, `JWT_APP_SECRET`) every participant needs a
  room pass; `JITSI_JWT_AUDIENCE` (default `jitsi`) and `JITSI_JWT_SUBJECT`
  (default the domain host; docker-jitsi-meet needs its XMPP domain, for example
  `meet.jitsi`) adjust the claims. Without the pair the room is open. The
  moderator and pass-only guarantees also need guest access and Jicofo
  auto-owner off and a Prosody module that applies the moderator claim
  (docs/self-hosting.md).
- **External teachers** join token-protected rooms from their RSVP link only
  with `TEACHER_INVITATIONS_RLS_LOCKED=true`, set after the
  `teacher_invitations` policy fix (spec 13 "External teacher invite codes").
- **Public** (default, nothing set): rooms open on meet.jit.si in a new tab and
  are never embedded, because meet.jit.si disconnects embedded calls after 5
  minutes and requires the first participant to sign in.

Partial or contradictory configuration makes meetings unavailable with a
message naming the variables (never a silent fallback to meet.jit.si); see the
resolution rules in spec 04. The error is logged once per distinct
environment when the configuration first resolves, and the super-admin
installation page (`/settings/installation`) shows a "Video (Petrios Meet)"
row with the mode and any configuration error (variable names only).
`/api/health` does not check meetings.

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

### Cloudflare Workers (staging and the production cutover)

Petrios also builds for Cloudflare Workers with `@opennextjs/cloudflare`
(`npm run cf:build`, `wrangler.jsonc`, custom entry `cfw/worker.ts`); the
operator guide is `docs/cloudflare-workers.md`. Render/Docker remains
production until the owner runs the cutover described there. `.dockerignore`
excludes every Cloudflare file, so the Docker image never contains them, and
the application code is identical on both runtimes.

- **Invariant:** the top-level wrangler environment (`petrios-staging`) is
  workers.dev only, with `triggers.crons: []`, no routes, and
  `CRON_ENABLED="false"`. Only `env.production` declares cron triggers and
  `CRON_ENABLED="true"`. `cfw/cron.test.ts` and `npm run cf:deploy:staging`
  enforce the top-level shape; the test also requires `env.production`
  triggers to equal `CRON_SCHEDULE` in `cfw/cron.ts` (spec 07).
- **Invariant:** production is one Worker (`petrios`) with two wrangler
  environments that share its name, its pinned `account_id` and its secrets. `env.production_preflight` is
  workers.dev only, declares `routes: []` and `triggers.crons: []`, and sets
  `CRON_ENABLED` and `OUTBOUND_EMAIL_ENABLED` to `"false"`. `env.production`
  (live) routes only `petrios.uk/*` in zone `petrios.uk` on the existing
  proxied DNS record (a plain route, never a custom domain, so no DNS record
  changes; `www.petrios.uk` is a Cloudflare 301 to the apex and gets no
  route), disables workers.dev, runs exactly `CRON_SCHEDULE`, and
  sets both flags to `"true"`. Both set `APP_URL=https://petrios.uk`, the same
  vars and the same `secrets.required` (the staging four plus `RESEND_API_KEY`,
  `MAIL_FROM`, the three `PRIVACY_*` and the two `DATA_*` disclosures).
  `productionConfigProblems()` in `scripts/cloudflare/lib.mjs` (unit-tested)
  enforces this, and `npm run cf:deploy:production` refuses any violation.
- `cf:deploy:production -- preflight|live|rollback` deploys only from a clean
  git checkout (never an export or copy), refuses a shell
  `CLOUDFLARE_ACCOUNT_ID` other than the pinned one, checks the Worker's
  secret names with read-only `wrangler secret list` (every required one
  present, none shadowing a var, no `SMTP_*`), runs `cf:build` and its guard,
  and confirms every deploy afterwards: wrangler can exit 0 without deploying
  (a declined prompt), so the script requires the version id from
  `WRANGLER_OUTPUT_FILE_PATH` and the routes, custom domains and cron
  schedules the Cloudflare API reports (live: exactly its route and
  `CRON_SCHEDULE`; preflight: none). `live` refuses without
  `--render-crons-disabled`, the operator's attestation that Render's
  scheduled jobs are suspended (one scheduler per database). wrangler 4.149
  replaces a Worker's routes only when the config lists at least one and never
  removes them otherwise, and updates routes and schedules concurrently, so
  `preflight` refuses while the Worker still has routes or custom domains; a
  first go-live that is not confirmed immediately deletes whatever it attached
  and clears the schedules; and `rollback` deletes the routes and clears the
  schedules through the Cloudflare API with the operator's wrangler login
  (custom domains are reported, never deleted), then tells the operator to
  resume Render's jobs only 15 minutes later (a Worker cron run in progress can
  last that long), then redeploys preflight. `check-secrets`/`secrets`
  validate a filled copy of `scripts/cloudflare/production-secrets.template.json`
  kept outside the repository (names and emptiness only) before
  `wrangler secret bulk`.
- **Invariant:** the staging Worker never emails real users. It serves the
  production database, so its links and certificate QR codes would point at
  `workers.dev`, and a delivery it marked `SENT` would never be re-sent from
  Render. The top level sets `OUTBOUND_EMAIL_ENABLED="false"` (required by
  `cf:deploy:staging` and its unit test); `lib/email.ts` then refuses every send
  before contacting a transport, except one whose every recipient is listed in
  the `OUTBOUND_EMAIL_ALLOWLIST` secret. A refusal is an ordinary send error,
  so delivery ledgers keep a retryable failure.
- **Invariant:** no local `.env*` value reaches a Worker. OpenNext compiles local
  `.env*` files into `.open-next/cloudflare/next-env.mjs`, which would fill any
  variable the Worker does not set. `cf:build` overwrites it with empty exports,
  then its guard fails on any key in that file and on any local `.env*` value
  found in the `wrangler deploy --dry-run` output (which does not contact
  Cloudflare) or the static assets. A value is checked when it has 12 or more
  characters, is not `NEXT_PUBLIC_*` (those only warn), and is not already in
  `.env.example`; matches are checked raw and JSON-escaped, and the guard reports
  names only. `cf:preview` reads variables only from `.dev.vars` and never
  falls back to `.env*` or the shell environment.
- react-pdf's yoga WebAssembly cannot be compiled at runtime on Workers.
  `cfw/yoga-install.ts`, the entry's first import, wraps
  `WebAssembly.instantiate` (`cfw/yoga-redirect.ts`): a call whose bytes match
  the recorded length and SHA-256 receives the module wrangler precompiled at
  upload (`cfw/yoga.wasm`), and every other call passes through. Each build
  regenerates that module from the installed `yoga-layout` and fails if the
  loader no longer instantiates exactly one embedded base64 wasm from bytes.
- `cf:build` copies `public/fonts/*.ttf` into `cfw/public/fonts`, which wrangler
  uploads as Data modules (`base_dir: cfw`, `find_additional_modules`). On
  Workers `process.cwd()` is `/bundle`, so the existing `node:fs` font reads for
  PDFs and the OpenGraph image work unchanged.
- `cf:deploy:staging` deploys only the top level, after `cf:build` and its
  guard pass, with `APP_URL` supplied on every deploy and required to be exactly
  `https://petrios-staging.<account-subdomain>.workers.dev`. Deploys treat the
  config as the source of truth, so environment-specific values are Worker
  secrets. Wrangler binds a first-deploy `--secrets-file` after the config and
  `--var` without a collision check, so the script reads the file's names
  (never values) and refuses one that names a `vars` key, a never-set-on-Workers
  name or an `APP_URL` fallback, or that lives inside the repository or is a
  `.dev.vars*`/`.env*` file.
- OpenNext 4.1.9's `cloudflare-node` response writer completes every write at
  once, so a streamed response (documents, recap/Recall audio) has no
  backpressure and a slow client's unread bytes would queue in the 128 MB
  isolate. `cf:build` rewrites that writer in the bundled server handler so a
  write completes only while a 64 KiB byte-sized response queue has room, and
  the client reading or cancelling releases it. The step fails unless the
  expected code matches exactly once, and the guard fails if the patch marker
  is missing from the dry-run upload. Render is unaffected (Node honours
  `drain`).
- Current limitation: `proxy.ts` runs as OpenNext's experimental Node
  middleware, and static assets bypass it (spec 13). Behaviour on a deployed
  Worker (Audio Recap memory with a 50 MiB source set on a real 128 MB isolate,
  browser-direct uploads, PDFs, cron jobs against a real database) has been
  verified only on local workerd; the staging checklist in
  `docs/cloudflare-workers.md` must pass before it is relied on.

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
| `APP_TIME_ZONE` | Default `Europe/London` | IANA zone for server-rendered dates and teaching-slot wall times (`lib/datetime.ts`); an invalid value falls back to the default with one logged error per distinct value. Not secret; server-only (client panels that show slot or Ops times receive the server's value as a prop). On Workers it is a plain `vars` entry when set; `TZ` is neither needed nor honoured there |
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
| `OUTBOUND_EMAIL_ENABLED` | Unset (email on); exactly `false` refuses | Deployment kill switch read by `lib/email.ts` at send time. `false` refuses every send before any transport is contacted and returns an ordinary error. Set to `false` on the Workers staging Worker (it serves the production database); Render never sets it |
| `OUTBOUND_EMAIL_ALLOWLIST` | Optional; used only while `OUTBOUND_EMAIL_ENABLED=false` | Comma-separated addresses that may still receive mail; a send goes out only if every recipient is listed. Staging test inboxes only |
| `CRON_SECRET` | Required to run jobs | Shared Bearer secret; no query fallback |
| `CRON_ENABLED` | Unset on Render; set in `wrangler.jsonc` on Workers | `scheduled()` in `cfw/worker.ts` dispatches cron routes only when exactly `true`. Exactly `false` also makes every `/api/cron/*` route answer 503 after authentication (`lib/cron-auth.ts`), so the staging Worker cannot run jobs over HTTP either. `false` at the top level and in `env.production_preflight`, `true` in `env.production`; unset means routes run |
| `TRUSTED_CLIENT_IP_HEADER` | Optional; `cf-connecting-ip` on Workers | Header `lib/rate-limit.ts` trusts for the client IP of login-link and group-code throttles. When set, only that header is read (missing = no IP). Unset keeps first `x-forwarded-for` hop, then `x-real-ip` |
| `ATTENDANCE_RATE_LIMIT_SECRET` | Optional HMAC key pseudonymizing check-in IPs for rate limiting; falls back to the service-role key |
| `LLM_PROVIDER` | Optional `anthropic` or `openai` | Provider pin; other values disable AI with a configuration error. Required when both keys and `OPENAI_BASE_URL` are set |
| `ANTHROPIC_API_KEY` | Optional | Enables Anthropic (default LLM); server secret; dedicated workspace recommended (Files API is workspace-scoped) |
| `ANTHROPIC_MODEL` | Default `claude-opus-5-5` | Must support adaptive thinking, `output_config.effort`, Files API PDFs and `web_search_20260209` |
| `ANTHROPIC_BASE_URL` | Optional | Anthropic-compatible gateway; must pass `anthropic-beta`, Files API uploads without redirects, web search |
| `ANTHROPIC_FALLBACKS` | On unless `off` | Server-side refusal fallbacks |
| `OPENAI_API_KEY` | Optional | Enables the OpenAI-compatible LLM adapter (when it is the only key or pinned) and OpenAI speech; server secret |
| `OPENAI_BASE_URL` | Default OpenAI v1 | Compatible internal/gateway/provider base (LLM adapter and OpenAI speech) |
| `OPENAI_MODEL` | Default `gpt-5.5` | OpenAI adapter model |
| `TTS_PROVIDER` | Optional `openai` or `elevenlabs` | Explicit speech-provider pin; invalid values disable speech with a configuration error |
| `ELEVENLABS_API_KEY` | Required when ElevenLabs selected | Speech API credential; server secret |
| `ELEVENLABS_VOICE_ID` | Required when ElevenLabs selected | Voice selected for new Audio Recap MP3 generation |
| `ELEVENLABS_MODEL_ID` | Default `eleven_multilingual_v2` | ElevenLabs speech model |
| `OPENAI_TTS_MODEL` | Default `gpt-4o-mini-tts` | Speech model |
| `OPENAI_TTS_VOICE` | Default `alloy` | Speech voice |
| `OPS_ENABLED` | Disabled only by exact `false` | Ops execution kill switch |
| `JAAS_APP_ID` | Optional; all three `JAAS_*` or none | Petrios Meet on 8x8 JaaS: AppID (`vpaas-magic-cookie-…`), also the JWT `sub` and room prefix. Not secret (it appears in room names) |
| `JAAS_API_KEY_ID` | Required with JaaS | JaaS API key id, the JWT header `kid`; must start with `<AppID>/`. Low sensitivity |
| `JAAS_PRIVATE_KEY` | Required with JaaS | RSA private key PEM (PKCS#8 `BEGIN PRIVATE KEY` or PKCS#1 `BEGIN RSA PRIVATE KEY`; real newlines or literal `\n`; surrounding quotes stripped). Critical secret, server-only, never in an error message or log |
| `JITSI_DOMAIN` | Optional; unset = `meet.jit.si` (public link-out mode) | Self-hosted Jitsi `host[:port]` (no scheme or path) for embedded rooms; `meet.jit.si` = public mode; `8x8.vc` only together with JaaS. Read server-side at request time |
| `NEXT_PUBLIC_JITSI_DOMAIN` | Legacy alias | Fallback for `JITSI_DOMAIN`, read the same way at runtime; no longer sent to the browser |
| `JITSI_APP_ID` | Optional; with `JITSI_APP_SECRET` or neither | Self-hosted Prosody token auth `app_id`, the JWT `iss` |
| `JITSI_APP_SECRET` | Optional; with `JITSI_APP_ID` | Prosody `app_secret` for HS256 room passes. Critical secret, server-only |
| `JITSI_JWT_AUDIENCE` | Default `jitsi`; needs the app id/secret pair | Self-hosted JWT `aud` |
| `JITSI_JWT_SUBJECT` | Default the `JITSI_DOMAIN` host without port; needs the pair | Self-hosted JWT `sub`; docker-jitsi-meet needs its XMPP domain (e.g. `meet.jitsi`) |
| `INSTANCE_SIGNING_KEY` | Optional | Ed25519 PKCS#8 DER base64 private key; critical secret |
| `DATABASE_URL` | Migration runner only | Direct database credential |
| `GOOGLE_SITE_VERIFICATION` | Optional | Search Console meta content |
| `PRIVACY_CONTROLLER_NAME` | Required production disclosure | Public controller legal name |
| `PRIVACY_CONTROLLER_ADDRESS` | Required production disclosure | Public controller postal/service address |
| `PRIVACY_CONTACT_EMAIL` | Required production disclosure | Public monitored privacy/DPO inbox |
| `DATA_HOSTING_REGION` | Required production disclosure | Accurate application/database/backup region summary |
| `DATA_TRANSFER_SAFEGUARDS` | Required where relevant | Public reviewed transfer-mechanism summary |
| `HOSTING_PROVIDER` | `cloudflare-workers` in both `wrangler.jsonc` `vars` blocks; unset elsewhere | Names "Cloudflare Workers" as the application host on `/privacy` and `/subprocessors` (`detectHostingProvider`, spec 13). Any other value is ignored; Render/Vercel/Railway are detected from their own platform variables |

Runtime: Node.js ≥ 20.12 (`package.json` engines) for Office text extraction
(`DecompressionStream('deflate-raw')`); Docker uses Node 22, Render Node 24,
Workers workerd.

`NODE_ENV`, `CI`, and hosting-provided variables also influence diagnostics and
test/development behavior. Only `NEXT_PUBLIC_*` variables may be intentionally
bundled into browser code.

On Cloudflare Workers, public configuration is read at request time by
`lib/runtime-config.ts`; set the unprefixed names `APP_URL`, `SUPABASE_URL`, and
`SUPABASE_ANON_KEY` (the `NEXT_PUBLIC_*` names remain runtime fallbacks). The
meeting variables are read at request time by `lib/meeting/config.ts` and,
like every environment-specific value there, are stored as Worker secrets
(`JAAS_PRIVATE_KEY` and `JITSI_APP_SECRET` are critical); `wrangler.jsonc`
declares none of them, so local preview runs in public mode. The staging Worker
serves the production database, so a JaaS app configured on both hosts counts
monthly active users across both (docs/cloudflare-workers.md). Never set `SUPABASE_INTERNAL_URL`, `AUTH_INTERNAL_URL`, or
`STORAGE_INTERNAL_URL` there: they name Docker-network hosts that a Worker cannot
reach. A Worker serving the production database must use byte-for-byte copies of
Render's `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ATTENDANCE_RATE_LIMIT_SECRET`, and `INSTANCE_SIGNING_KEY`.
The calendar-feed token, Recall and unsubscribe HMACs, the rate-limit
pseudonym, and the auth cookie name derive from these values, so a hosting move
never rotates them. `CRON_SECRET` is only the `/api/cron/*` bearer token: each
Worker has its own, and the production Worker gets a new one so an external
scheduler still holding Render's value is refused after the cutover.

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
- Event production completeness is stated; side effects remain nonblocking and
  are registered with `after()` on request paths or awaited in crons, never
  left floating.
- URL inputs are protected against DNS, redirect, IPv4/IPv6, and cloud-metadata
  SSRF, with network egress defense in depth.
- Portable records are schema-validated and trust level is not confused with
  embedded-key consistency.
- Key rotation/revocation/backward verification is designed before rotating a
  production federation identity.
- Self-host instructions retain Supabase auth requirements.
- Every environment secret stays server-only and production URL/mail failures are
  explicit.
