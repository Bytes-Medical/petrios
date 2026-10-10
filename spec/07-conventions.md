# 07 — Engineering, delivery, and verification conventions

## Change standard

Petrios changes are reviewed as end-to-end behavior, not isolated UI code. A
feature normally spans:

- a server component/client component boundary;
- a server action or route handler;
- shared domain validation;
- one or more DAL functions;
- Postgres constraints/RLS/migrations;
- email, notification, PDF, webhook, or AI side effects;
- tests; and
- a specification update.

Before opening a PR, run:

```bash
s/lint && s/typecheck && s/test && s/build
```

Stop the development server before the production build. Run
`npm run test:e2e` when public routing, responsive navigation, auth entry, or a
tested browser journey changes. Commits must include a DCO sign-off as described
in `CONTRIBUTING.md`.

### Commit message contract

Authored commits and pull-request titles use Conventional Commits:
`type(optional-scope): imperative subject`. The repository extends
`@commitlint/config-conventional` through `commitlint.config.mjs`; accepted types
are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
`style`, and `test`. Scope is optional and lower-case. Breaking changes use both
the `!` header marker and a `BREAKING CHANGE:` footer. A conventional header does
not replace the required DCO `Signed-off-by` footer.

The commitlint packages are pinned to `20.2.0`, whose declared runtime supports
Node 20. Commitlint 21 requires Node 22.12 or newer; upgrade the CI Node version,
package engine/support documentation, both commitlint packages, and lockfile
together rather than allowing an incompatible floating major.

`s/commits --from <base> --to <head>` is the tool-neutral local command. CI uses
full Git history and applies these exact ranges:

- pull request: every commit in `base.sha..head.sha` plus the PR title, because
  GitHub squash merge uses the title as the resulting commit subject; and
- push to `main`: every commit in `before..sha`, falling back to the last commit
  only when GitHub's pre-push object is unavailable.

Commitlint's standard ignores remain enabled for Git-generated merge commits,
reverts, and semantic-version tags. Do not add a broad custom ignore to make an
authored message pass; correct or reword the commit instead.

## Repository ownership map

| Area | Responsibility |
|---|---|
| `app/**/page.tsx` | Route composition and server-rendered data loading |
| `components/` | Reusable UI; client components only where interaction/browser state requires them |
| `app/actions/` | Interactive command/query boundary, authorization, orchestration, revalidation |
| `app/api/` | HTTP, cron, streaming, feed, and supported API contracts; self-authentication required |
| `lib/db/` | All table access, projections, service/RLS choice, driver-error conversion |
| `lib/<domain>/` and pure `lib/*.ts` | Validation, deterministic calculations, formatting, provider-neutral domain logic |
| `lib/email.ts` / `lib/email-templates.ts` | Transport adapter and core HTML templates |
| `lib/ai/` | General LLM and speech provider adapters |
| `lib/ops/` | Ops inference policy, safety, jobs, assistant tools, and approval execution |
| `supabase/migrations/` | Immutable ordered schema/RLS history |
| `cfw/`, `wrangler.jsonc`, `open-next.config.ts`, `scripts/cloudflare/` | Cloudflare Workers entry, config, and `cf:*` build/preview/deploy scripts; excluded from the Render/Docker image (spec 09) |
| `spec/` | Detailed implemented contract and explicitly labelled RFCs |

Server code runs unchanged on both Node (Render) and Cloudflare Workers. Do not
buffer whole documents, audio, or PDFs where a stream will do (a Workers isolate
has 128 MB shared by concurrent requests), do not read the filesystem except
bundled `public/fonts`, and do not compile WebAssembly at runtime.

Do not put a convenient table query in a page/action. Do not put authorization
inside a client component. Do not put a provider HTTP call at a feature call
site when a sanctioned adapter exists.

## Data access and authorization

ESLint bans imports of server/browser Supabase clients and `lib/db/client.ts`
outside `lib/db/`, except a reviewed list of auth-plane files and the
authorization seam `lib/auth.ts`.

A DAL function should:

- accept trusted scope explicitly (`orgId`, `departmentId`, record id);
- select the smallest useful projection;
- include tenant predicates even when foreign keys or RLS also help;
- choose `getDb()` when an end-user RLS session is the actor;
- choose `getServiceDb()` only for a documented accountless/system/API reason;
- normalize raw driver errors with `toDbError`; and
- make state predicates (`status = pending`, `date_start > now`) visible for
  concurrency-sensitive updates.

Server actions should establish actor first, resolve the target under current
tenant, then check the role derived from that target. A client-supplied
`departmentId` must not authorize a session from another department. API routes
must self-authenticate because `/api/*` bypasses the proxy.

### Department and session moderation

`isDepartmentModerator` / `requireDepartmentModerator(departmentId)` resolve
the department's owning organisation on the server (service-role
`findDepartmentOrgId`) and decide in the pure `lib/department-authz.ts`:

- a super admin may moderate any department;
- anyone else must be working in the department's organisation (their current
  org from `requireOrg()`), and be org_admin of it or hold a
  `department_members` moderator row whose `department_id` **and** `org_id`
  match it (a row stamped with another org never counts).

`requireDepartmentModerator` returns `{ orgId }` — the department's
organisation. Department-id actions scope every follow-up read and write with
that `orgId` (slot inserts, session inserts, audience resolution, member
removal) instead of trusting the client's pairing of org and department.
`requireSessionModerator(sessionId)` is the session-level form: it looks the
session up in the current org and then applies the department rule.
Org-scoped reads that receive an `orgId` argument from a server component call
`requireOrgScope(orgId)` (current org, or any org for a super admin).
`updateSession` edits only the allow-listed descriptive fields in
`lib/session-updates.ts`; ownership and attendance/group-code fields are
rejected. Service-role DAL listings of department members take a required
`orgId` so a session or slot bound to another tenant's department reaches
nobody.

`removeDepartmentMember` (which also deletes the target's organisation
membership) refuses a target who is not a member of that department in that
organisation, and never removes an administrator: department role
`department_admin`/`org_admin`, organisation role `department_admin`/`org_admin`,
or a `department_admin` row for any department of the organisation (so one
department's moderator cannot evict a peer moderator). Approving a department
join request grants the stored `trainee`/`faculty` role but never demotes a
higher role the requester already holds in that department (read scoped to the
request's organisation) or organisation.

### Rota authorization, kill switch, and not-installed objects

Rota availability (spec 14) uses its own guards in `lib/rota/access.ts` and
never calls `requireDepartmentModerator` or `isSuperAdmin`.
`requireRotaModerator(departmentId)` decides in the pure `decideRotaModerator`
(`lib/rota/authz.ts`) from the department's organisation, the caller's current
organisation, org-admin status of that organisation, and the organisations of
the caller's moderator rows for the department. Super-admin status is not an
input, so a super admin acting in another organisation is refused even though
the general department rule above admits them. `requireRotaUploaderOrModerator`
adds the per-department `rota_uploaders` grant (department organisation equal
to the current organisation), and `requireRotaOrgAdmin` covers settings. Every
guard checks the environment first (the kill switch, the identity secret), then
authorization, and only then the installed migrations (063, and 064's marker
including `EXCUSED`), the organisation's `enabled` flag, and department
enrolment, so a caller without a rota role is always "forbidden" and cannot
probe whether a department uses rota. The deletion-only cleanup guards
(`requireRotaOrgAdminForCleanup`, `requireRotaModeratorForCleanup`) check the
role and migration 063 only, so stored data can be deleted with the switch
off.

The pattern for an off-by-default feature whose migration the owner applies
later:

- an environment kill switch that enables only on the exact string `"true"`
  (`ROTA_INTEGRATION_ENABLED`), pinned to `"false"` wherever a non-production
  host serves the production database;
- a DAL that maps "relation/function does not exist" (PostgREST `PGRST205`/
  `PGRST202`, Postgres `42P01`/`42883`) to a typed not-installed error
  (`RotaNotInstalledError`), which callers treat as "unavailable": never a 500
  and never an error log;
- Server Actions that return `{ ok: false, message }` for every expected
  failure, including unavailable and forbidden, and never log request bodies;
- versioned RPCs (`_v1`) whose errors are fixed `rota:<code>` messages with no
  interpolated ids or values; and
- a marker function the application reads to discover whether a migration is
  applied (`recall_catchup_eligible_statuses_v1()`, falling back to the
  pre-migration behaviour when it is missing); a feature that depends on a
  second migration (rota on 064) treats a missing marker as "not installed",
  and TypeScript logic mirroring an RPC (`computeAttendanceFromEvidence`)
  follows the same marker so the two never disagree.

The deliberate exceptions to "nothing runs while the switch is off" are
deletion only: the rota purge runs on every `post-session-reports` pass so data
already stored keeps its retention promise after the switch is turned off
(before migration 063 it is a silent no-op), and an org admin can disable,
un-enrol and remove uploaders, and a moderator revoke links, from a
cleanup-only Settings section that appears only while the organisation still
holds rota data. Hooks on session edits
and membership removal run only while the switch is on; the flag snapshot and
read view cover the gap.

### Error vocabulary

DAL modules use:

- `DbError` for normalized database failure;
- `DbNotFoundError` for missing rows; and
- `DbConflictError` for uniqueness conflict.

`toDbError` preserves driver code/cause and maps `PGRST116` and Postgres `23505`.
Feature code may produce safe domain errors for validation/concurrency. Public
HTTP APIs return an HTTP status plus `{ error, code }`; internal routes should
avoid exposing raw driver/provider text.

Not all existing DAL call sites are fully normalized, and some public/internal
route handlers currently map authorization errors to generic 500 responses.
Treat the conventions above as the direction for touched code, and document any
compatibility-preserving exception.

## Server actions

Server action files use `'use server'` and export async functions only (a Next.js
16 restriction). Put synchronous constants/helpers in another module or keep
them unexported.

Mutation order should be deliberate:

1. authenticate and derive tenant;
2. resolve target and authorize role;
3. normalize and validate all untrusted input;
4. perform the durable state transition;
5. perform dependent durable transitions or documented compensation;
6. perform best-effort external/internal side effects;
7. revalidate the minimal affected paths; and
8. return a small serializable result (for visitor-facing actions, the
   discriminated result below).

If side effects are intentionally nontransactional, state which durable result
survives failure. Catching an error is not idempotency.

### Visitor-facing action results

Next.js replaces the message of an error thrown from a Server Action in
production (staging visitors saw only a generic error, never the real reason). Actions
reached by a public page or a capability link must therefore **return** every
expected, user-facing failure as a discriminated result,
`{ ok: true, ... } | { ok: false, message }`, and throw only for genuinely
unexpected errors (database failures, missing configuration, a compensated
failure after a won race). The client shows `message` from an `ok: false`
result in a persistent inline block with `role="alert"` (toasts auto-dismiss
and the toast region is not announced to screen readers); its `catch` block
shows a generic friendly message there and never `error.message`. A failure
that retrying cannot fix carries `final: true` (the claim actions use
`slotUnavailable: true`), and the client calls `router.refresh()` so the
server page replaces the form with the record's current state. Current examples: `submitFeedback` (spec 05),
`respondToInvitation`, `claimSlotByCode`/`claimSlotAsMember` (spec 04;
the member claim shares the public claim path), and the Petrios Meet actions
`getMeetingJoin`/`getExternalTeacherMeetingJoin`/`checkInFromMeeting` (spec 04
"Petrios Meet"; these go further and also return unexpected failures as a
retryable `{ ok: false, reason: 'unavailable' | 'failed' }`, logged without any
token, key, or email). A malformed-input `TypeError` stays a thrown error rather
than a returned message.

### Work after the response

Never leave a promise floating (`void promise`, or an un-awaited `.catch()`) on
a server path: on Cloudflare Workers, work not registered with `waitUntil` may be
cancelled once the response is sent. In server actions and route handlers, wrap
best-effort follow-up work in `after(() => task())` from `next/server`. OpenNext
maps it to `ctx.waitUntil` (about 30 s) and the Node server runs it in-process;
either way it runs after the response and does not slow the action. `after()`
throws outside a request scope, so do not call it in lib code that crons can
reach. Cron routes and the code they reach await instead, and the awaited task
must swallow its own failures (as `emitWebhook` does).

## HTTP and cron handlers

HTTP handlers should declare their authentication contract in a top-level
comment and avoid accepting tenant scope from unchecked JSON/query input.

Cron routes use only:

```text
Authorization: Bearer <CRON_SECRET>
```

`lib/cron-auth.ts` deliberately has no query-string fallback because query
secrets leak through access logs and copied URLs. A missing `CRON_SECRET` rejects
every request. Use a bounded batch and a database watermark/unique/CAS guarantee
because schedulers may retry.

Long jobs also take a per-run work budget (`lib/run-budget.ts`: 8,000 estimated
subrequests and 10 minutes, under the Workers 10,000-subrequest default and the
15-minute Cron Trigger wall cap). Reserve an estimated cost before each step,
stop starting work once it is spent (exhaustion is sticky), keep unreached work
in a per-recipient ledger with the watermark open, and report deferred counts in
the JSON response. A job that works through several independent units (such as
sessions) gives each a capped slice (`createBudgetSlice`) that holds back a
share for the units behind it; a slice running out defers only its own unit,
so one unit can never starve the rest. A capped bulk read (one PostgREST page)
may only be a fast path for skipping finished work: confirm a miss with an
exact lookup before reserving the full cost of a step, or a backlog of rows the
page omits can spend the whole budget on work that is already done. Bound
memory-heavy fan-out with `mapSettledWithConcurrency`
(`lib/concurrency.ts`). Cron code awaits side effects such as webhooks rather
than deferring them.

Current cron families:

| Route | Primary idempotency |
|---|---|
| `session-reminders` | Per-recipient `SESSION_REMINDER` delivery rows (related_id = session id) plus `reminder_sent_at` watermark; watermark closes only when every recipient is `SENT` or has used 3 attempts |
| `post-session-reports` | Finalized-session report watermark plus per-recipient `ATTENDANCE_CERTIFICATE` delivery keyed by certificate id; watermark closes only after one budget-bounded pass completes every recipient. Every run, including the early "no sessions" return, also awaits the deletion-only rota purge (`rota_purged` in the response; a failure is logged as `[rota] purge failed` and never fails the job) |
| `recall-send` | Per-recipient catch-up invite delivery plus set watermarks; watermark closes only after all eligible sends |
| `recall-awards` | Unique completion/certificate plus claimed `ATTENDANCE_CERTIFICATE` delivery; 10 completions per run, two concurrently |
| `ops-weekly` | Pending-action dedupe, chase counts, Ops memory; low-score notification has no dedupe |
| `ops-synthesis` | Unique synthesis and Recall set per session |

On Cloudflare Workers, Cron Triggers reach these same routes through
`scheduled()` in `cfw/worker.ts`. `cfw/cron.ts` maps each trigger expression to
exactly one route and calls the OpenNext fetch handler with
`GET ${APP_URL}/api/cron/<job>` and the Bearer header inside `ctx.waitUntil`,
logging only the HTTP status. It dispatches nothing unless `CRON_ENABLED` is
exactly `true`, `CRON_SECRET` is set, and `APP_URL` is an HTTP(S) URL. When
`CRON_ENABLED` is exactly `false` (the staging Worker), `lib/cron-auth.ts` also
answers every authenticated `/api/cron/*` request with 503, so the jobs cannot
run over HTTP there either; Render leaves it unset.
**Invariant:** only one scheduler, Render's or the Worker's, runs these jobs
against a given database at any time. The self-host
`/api/internal/scheduler/tick` route is not used on Workers.

Newsletters are not cron routes. Moderator generation is unique per
organization/department/week, and delivery idempotency is per issue/member with
a revision-bound claim ledger.

Watermark timing matters. Recall invitation, session reminder, and post-session
certificate delivery deliberately keep their watermark open while any recipient
delivery is unfinished (as each subsystem spec defines), while successful
recipient rows skip on retry. Other jobs may retain different explicitly
documented partial-failure behavior; preserve or deliberately redesign the
relevant contract.

## Time and date rules

- Store instants as Postgres timestamps/ISO strings.
- Parse/compare on the server using `Date` only after invalid-date checks.
- Specify which session edge a rule uses (`date_start` or `date_end`).
- Specify inclusive versus exclusive endpoints.
- Use `??` when zero is a valid setting; `||` changes zero into a default. The
  feedback window (`lib/feedback-window.ts`) is the shared reference: one helper
  used by the action and both public pages, with nullish defaults.
- Use shared pure helpers for calculations that appear in both jobs and actions.
- Formatting for email/PDF/UI may use British locale, but formatted strings are
  never comparison keys.
- Server clocks are UTC (always on Workers, which ignore `TZ`; usually in
  Docker). Every date or time the server renders — emails, certificate/audit/
  portfolio PDFs, server components, crons, Ops drafts — is formatted through
  `lib/datetime.ts` (`formatInAppTimeZone`, `formatAppDate`,
  `formatAppDateTime`) in `APP_TIME_ZONE` (an IANA name, default
  `Europe/London`; an invalid value falls back to the default, and the error
  is logged once per distinct value because the resolved zone is memoized).
  Never call `toLocale*String` without a `timeZone` on the server.
  Calendar-day keys use `appDayKey`; a wall-clock time entered for the app zone
  becomes an instant with `appWallClockToIso`.
- Client components keep the viewer's own zone. A timestamp a client component
  renders during SSR goes through `components/LocalSessionDateTime.tsx`
  (`LocalDateTime` accepts optional `Intl.DateTimeFormatOptions`) so the server
  render and hydration agree. `APP_TIME_ZONE` is server-only, so a client
  component that shares the app-zone helpers takes the server's
  `appTimeZone()` as a required `timeZone` prop and passes it on
  (`describeSlot(slot, timeZone)`, `formatDateTimeShort(iso, timeZone)`,
  `formatInAppTimeZone(value, { ..., timeZone })`). `SlotClaimPanel`,
  `OpenSlotsPanel` (also via `PersonalDashboard`), `ScheduleManagerPanel` and
  `PendingActionsPanel` do this, so their SSR text, hydration and the emails
  agree for any configured zone.
- The ICS feed emits UTC (`Z`) timestamps and needs no zone.
- Period windows that are defined as UTC calendar days (newsletter weeks,
  portfolio/dossier periods, audit date filters) stay UTC; label them from the
  UTC key, not in the app zone.

## Input and durable JSON validation

Validate at the trusted server boundary even when HTML inputs constrain values.
Use explicit length caps for text entering email, prompts, PDFs, notifications,
or JSON columns. Prefer Zod for structured model/API output and domain functions
for simple state/date/form rules.

JSON persisted for later interpretation must snapshot enough semantics to remain
readable after configuration changes. Feedback stores labels/types with answers;
portable records carry a format; webhook events carry a stable event name. New
public formats need a version.

## Email transport

All transactional callers use `getEmailClient()` and `getFromAddress()` from
`lib/email.ts`.

Transport selection is:

1. `SMTP_HOST`: Nodemailer SMTP (optional auth, pooled process-wide);
2. otherwise `RESEND_API_KEY`: Resend HTTP API;
3. otherwise nonproduction: log-only success sink; or
4. otherwise production: structured “configure a transport” error.

SMTP takes priority when both are configured. `MAIL_DEV_REDIRECT` replaces all
recipients with one controlled address — development only; both the
redirect and email metadata logging are ignored in production builds.
Neither selects a transport. Attachments are
raw bytes/base64 adapted to each provider.

`MAIL_FROM` is preferred, with legacy `RESEND_FROM_EMAIL` fallback. A bare
configured address receives the `Petrios` display name. The known legacy display
names `Byte Teaching` and `Bytes Teaching` (including hyphenated forms) are
rewritten to `Petrios`; any other explicit organization display name is
preserved. Production throws if neither variable exists. Development uses
`Petrios <dev@localhost>` and avoids sending that invalid address through Resend.

Callers must inspect `{ data, error }`; the adapter generally returns provider
errors rather than throwing. Some higher-level helpers convert error to throw,
while many flows deliberately continue. The relevant subsystem spec defines
delivery semantics.

### Email HTML safety

Dynamic values are untrusted, including names, session titles/descriptions,
comments, topics, and model output. New templates must HTML-escape text and
attribute-escape URLs at the rendering boundary, or use a safe renderer.

This is not yet a universal implemented guarantee: several core templates in
`lib/email-templates.ts` directly interpolate dynamic text, including feedback
comments. Ops newsletter/email helpers apply stronger escaping. When touching an
unsafe core template, add escaping and tests without claiming unrelated templates
are already safe.

## In-app notifications

Notifications are durable user-scoped rows inserted by system helpers and read/
marked by the recipient. A notification can accompany email but is an independent
side effect. It does not prove email delivery and usually has no exactly-once
constraint. Use stable type strings, concise text, and an organization-local
link. Do not put secrets, raw feedback, or sensitive personal detail in the bell
body.

## AI and speech provider conventions

- General inference uses `lib/ai/llm.ts`; `lib/ai/provider.ts` resolves the
  provider and builds the Anthropic client; `lib/ai/anthropic-files.ts` is the
  only Files API caller. Nothing else calls an LLM provider.
- Anthropic calls always stream (`.stream(...).finalMessage()`), set
  `output_config.effort` explicitly, never send `thinking`, sampling parameters,
  an assistant prefill or a forced `tool_choice`, and check `stop_reason`
  (`refusal`, `max_tokens`, `model_context_window_exceeded`, `pause_turn`).
- Branch on typed SDK errors (`Anthropic.BadRequestError`, …), never on message
  strings. Never log a non-HTTP SDK error message: it can quote model output.
- Read the model that served a response from the response (refusal fallbacks
  can change it); never persist the configured model name as provenance.
- Private document inputs are lazy `LlmFileInput`s (`lib/ai/streaming-body.ts`)
  opened per request attempt and verified against stored size/SHA-256 while
  they stream; never download whole documents before inference.
- Ops inference uses `lib/ops/gateway.ts` and its purpose allow-list.
- The Ops tool loop (`lib/ops/agent-loop.ts`) is the sole sanctioned direct
  model caller outside the general adapter.
- Speech uses only `lib/ai/tts.ts`. Provider-specific headers, endpoints,
  defaults, errors, and metadata stay behind that boundary; actions must not
  branch directly on OpenAI or ElevenLabs. Speech never depends on the LLM
  provider.
- Model output is untrusted: validate schema, enforce length/content rules, and
  never derive tenant/authorization from it.
- Feedback/user content must be labelled and fenced as data. The regular
  on-demand feedback summary is a known weaker path documented in spec 05.
- Prompt/run logs store hashes and operational metadata, not raw feedback or
  secrets.

## UI conventions

Petrios uses a restrained monochrome, monospaced visual language with clear
borders, compact status chips, and responsive server-rendered pages. In the
signed-in app, continue to use the shared primitives (cards, buttons, wordmark,
form controls, navigation) and existing label maps instead of one-off
styling/status strings; the public site uses its own `components/hud` system
(below).

Dropdowns are the custom themed listbox in `components/Select.tsx`, not
native `<select>` — a native select's open menu is OS-rendered and cannot
match the theme. It keeps the native wrapper's API (`<option>` children,
`name`/`value`/`defaultValue`/`onChange(e.target.value)`), carries its value
through a hidden input for FormData, and implements listbox keyboard
behaviour (arrows, Home/End, Enter/Escape, single-char type-ahead). Do not
introduce raw `<select>` elements in new UI.

Accessibility requirements:

- use semantic headings, forms, tables, buttons, and links;
- give controls visible/focus labels and keyboard behavior;
- do not communicate state by color alone;
- keep loading, empty, permission, expired-capability, and partial-failure states
  explicit; and
- preserve mobile navigation/browser smoke coverage.

Shared small-text tokens must also retain at least 4.5:1 contrast against their
normal paper/card surfaces. The current `gray.500` and `clay.600` values and
their measured ratios are specified in spec 13. Token checks are regression
guards, not a substitute for a full WCAG audit of authenticated workflows,
generated PDFs, email, calendar, video, and user-authored content.

Client components should receive minimal serializable data. Secrets, service
credentials, raw audit rows, and server-only provider configuration never enter
client props.

### Public site design system (`components/hud`)

The signed-out marketing and legal pages (`/`, `/features`, `/news`,
`/open-source`, `/contributors`, `/privacy`, `/privacy/choices`,
`/subprocessors`, `/data-processing-agreement`) use the Clinical HUD system in
`components/hud/`. The signed-in app does not use it and renders exactly as
before.

- **Scope.** Every public page renders inside `HudShell`, an async server
  component that outputs `<div data-hud-root data-display>` with the skip link,
  `PublicNav`, one `<main id="main">` (a 56rem `page` or 48rem `prose` column),
  and `Footer`. Pages never render `PublicNav` or `Footer` themselves. All styles
  live in one CSS module, `components/hud/hud.module.css`; the `--hud-*` tokens
  exist only on its root class, and the additive Tailwind `hud.*` colours are
  `var(--hud-*)`, so outside a HUD subtree they inherit or go transparent. Never
  import `components/hud` from app routes (dashboard, sessions, departments,
  settings, ops, admin, super-admin, certificates, audit). The only global
  selectors are the `:global(html):has(.hud[data-display=…])` overscroll rules,
  which match only while a HUD root is mounted.
- **Anatomy versus placement.** Element-level rules are written inside
  `:where()`, so any component class or Tailwind utility outranks them. The one
  deliberate lift is the `.prose` 12px block gap, written with `:is()` at
  specificity (0,0,2) so it beats Tailwind preflight's `p { margin: 0 }` while
  classes and utilities still win. Component
  classes own anatomy (colour, border, type role, internal padding); utilities own
  placement (outer margin, grid placement, max width). Never set the same property
  from both. No `dark:` utilities: Night comes only from `data-display`. Type roles
  are module classes rather than Tailwind `text-*` sizes, which tailwind-merge
  would misread as colours. `.hud` inherits IBM Plex Mono from the root layout's
  next/font and never redeclares the family.
- **Chips by shape.** `StatusChip` kinds are `info`, `ok` ●, `off` ○,
  `attention` ▲, `pending` ◌, and `live` ●. State is a glyph plus words, never
  colour alone (IEC 60601-1-8 practice). The chip owns its aria-hidden glyph and
  callers pass only the words. Callers choose the kind explicitly; never derive it
  by matching status text (the subprocessors register passes a `tone`).
- **Readout truth rule.** `Readout` and `SpecStrip` show verified product facts
  only. Every item carries a `source` string (a spec section or code constant)
  that the type checker requires and the page never renders. No invented metrics,
  uptime, percentages, or counts; counts are computed from data (“People listed”
  on /contributors). Changing a cited fact (for example
  `SESSION_DOCUMENT_MAX_BYTES`, `SLOT_SPLIT_OPTIONS`, `MAX_TEACHING_COORDINATORS`,
  the Recall attempt limit, or the 6-digit join code) must update the strip in the
  same change. The /open-source `TerminalBlock` mirrors the `docs/self-hosting.md`
  quick start and must move with it. Its `HealthCheck` fetches same-origin
  `/api/health` only when the visitor presses “Run health check” (no request on
  page view, no polling, a 10-second timeout, and `lib/health-check.ts`
  classifies the response). The button is disabled only until hydrated; while a
  check runs it is `aria-disabled` and ignores presses, so keyboard focus stays
  on it.
- **Display modes.** Day (the default, no cookie), Night, and Match device
  (follows `prefers-color-scheme`). `HudShell` reads the `petrios-display` cookie
  on the server (`lib/public-display.ts`), so every server and RSC render is
  already correct, with no inline script and no hydration warning.
  `DisplayControl`, the footer fieldset, and the `PublicNav` menu button are
  disabled until hydrated, so without JavaScript they honestly do nothing. A
  duplicated cookie name resolves to its last occurrence on both sides (Next's
  `cookies()` rule), so server and client never disagree. A choice
  writes or deletes the cookie, sets `data-display` on the root at once (no
  transition), and calls `router.refresh()` so client-cached pages pick it up; the
  control also reconciles the root with the cookie on mount and on a bfcache
  `pageshow`. The cookie contract and its PECR rationale are in spec 13.
- **Frozen shared primitives.** Public CTAs are links styled with `hudLink`
  (primary, secondary, or ink; md or sm), imported from
  `@/components/hud/HudLink`. The variants live in `hudLinkVariants.ts`, because a
  `hudLink.ts` beside `HudLink.tsx` would resolve to the wrong file on
  case-insensitive file systems. `HudLink` marks off-site links with an
  aria-hidden ↗, and no link uses →. `HudWordmark` and `hudLink` exist so that
  `Wordmark`, `Button`/`buttonVariants`, `Badge`, `Card`, `Nav`/`NavShell`,
  `AppFooter`, `LoginCard`, and `app/globals.css` stay unchanged for the app.
  `/login*`, `/join/dept`, `/signup`, and `/verify/*` keep the app look until they
  adopt `HudShell`.
- **Landmarks and contents.** The public nav is the only `<nav>` named “Main”;
  the footer is deliberately not a `<nav>`. `OnThisPage` takes an explicit
  `SECTIONS` constant per page (never `React.Children`): `chips` on /features and
  a `rail` on the legal pages, sticky beside the prose from 1024px (on
  /subprocessors it stays above the body so the register gets the full width).
  It never contains “Features” or “Sign in”.
- **Drawn marks, not missing glyphs.** The self-hosted Plex Mono subset has no
  arrows or geometric shapes, so they fall back to a size-adjusted Arial face.
  Marks whose size or position matters are drawn instead: the hero ▪ separators
  (CSS squares), the comparison connector and the `MissingDisclosure` ▲ (inline
  aria-hidden SVG in `currentColor`). Decorative `::before` markers use
  `content: "▸" / ""` (after a plain fallback declaration) so screen readers do
  not announce them; drawn CSS marks get `CanvasText` under forced colours.
- **Motion and contrast.** The landing calibration strip is the only load motion
  on the site, and it is CSS-only. Its contract, the HUD token values and ratios,
  and the placement rules are in spec 13 (“Homepage motion” and “Public HUD
  tokens”).

### Latency conventions

Every mutation click is at least two server round trips (action, then
`router.refresh()`), so the rules below keep both legs short and honest:

- **Pages fetch parallel-by-default**: stage awaits by true data
  dependency (fetch the session first, then everything keyed on it in one
  `Promise.all`). Only reads are parallelized — never check-then-write
  mutation orders.
- **Role checks are cached and concurrent** (`lib/auth.ts`): per-request
  `cache()` dedup, sibling role queries issued together and OR-combined.
- **Hot authed routes ship a `loading.tsx`** built from
  `components/Skeleton.tsx` (use `SkeletonNav`, never `NavShell` — loading
  files must not fetch).
- **Mutations use `hooks/useActionWithRefresh`** so the pending state
  (Button's `pending` prop) spans the action AND the refresh re-render;
  the nested `startTransition` around `router.refresh()` is required
  (React 19 async-transition rule), don't remove it.
- **Heavy client-only libraries load via a dynamic client wrapper**
  (`SessionCalendarLazy`, and `MeetingEmbed`, which loads `@jitsi/react-sdk`
  with `ssr: false` inside `JitsiMeetingPanel`), never statically from a page.
- **Signed-in pages get the utility footer automatically** — `AppFooter`
  renders once from the root layout on app-area routes (© / AGPL / Source /
  Privacy; the Source link is the AGPL section-13 route every self-hosted
  instance inherits). Public pages get `PublicNav` and the marketing
  `Footer` from `HudShell`; don't add any of them per-page.
- **Dense management pages use collapsible sections**
  (`components/SettingsSection.tsx` — a native <details> styled like Card,
  server-renderable, counts in the header, optional internal scroll)
  stacked in a single column — side-by-side grids of collapsibles leave
  dead zones when one section opens; prefer collapsed-by-default over
  columns for page length.

## Test strategy

### Unit tests

Vitest runs `vitest run` over `lib/**/*.test.ts`, `cfw/**/*.test.ts`, and
`scripts/cloudflare/**/*.test.ts`. Pure domain modules colocate tests, including
attendance windows/priority, Recall analytics/tokens, federation
signing/canonicalization, cron auth, Ops anonymization/synthesis/newsletter,
slot helpers, Workers cron safety and secret-guard logic, and other
deterministic behavior.

For a stateful flow, extract and test the pure decision separately, then add
database/integration coverage where constraints/RLS are the real guarantee. Test
exact boundaries and negative cases, not only representative success.

### Browser smoke tests

Playwright starts the public app with placeholder Supabase/config and Chromium.
The current suite is unauthenticated and focuses on public/responsive surfaces;
it is not proof of authenticated RLS or end-to-end email/database behavior.

- `smoke.spec.ts`: routing, exact public headings, health and well-known JSON,
  the auth wall, and the security-header baseline.
- `landing.spec.ts`: the calibration-strip h1 and its accessible name, the
  no-JavaScript render and inert controls, section order, CTA targets, the
  typewriter at 700ms with no layout shift, reduced motion, keyboard focus,
  overflow from 320px to 1440px, the tagline under WCAG 1.4.12 text spacing,
  decorative list markers absent from the accessibility tree, no canvas, and
  Display cookie persistence across reload, client navigation, and back.
- `public-pages.spec.ts`: one Main nav and one `main` per public route, the
  footer ownership line and legal links, contents anchors, the cookie and GPC
  disclosures, the subprocessors register width and status chips, the
  user-triggered health check (focus kept on keyboard activation), and
  the contributors head count.
- `contrast.spec.ts`: an in-page WCAG contrast probe over the nine public routes
  in Day and Night (spec 13 “Public HUD tokens”), with no extra dependency.
- `mobile.spec.ts`: the 390px menu contract and horizontal overflow on the inner
  and legal pages.

### Required risk-based cases

- cross-organization and wrong-role access;
- accountless/capability expiry and replay;
- concurrent compare-and-set losers;
- cron repeat and partial side-effect failure;
- null versus zero configuration;
- untrusted HTML/prompt content;
- duplicate records where a lookup assumes one;
- locked attendance and later evidence; and
- unavailable email/LLM/TTS/webhook providers.

## Continuous integration and security

`ci.yml` on pushes to main and pull requests runs:

- Node 20 `npm ci`;
- Conventional Commit checks for the complete pushed/PR range and PR title;
- lint, `tsc --noEmit`, unit tests, and production build;
- migration filename/prefix uniqueness sanity; and
- Playwright Chromium public smoke tests.

The security workflow runs on pushes, PRs, and weekly schedule:

- TruffleHog secret scanning;
- Semgrep JavaScript/TypeScript/React/Next/OWASP/secrets rules;
- CodeQL extended JavaScript/TypeScript analysis;
- production dependency audit at high severity or above; and
- changed-migration RLS guard.

Browser-facing responses additionally receive the HSTS, CSP, anti-framing,
MIME, referrer, permissions, and cross-domain-policy baseline from `proxy.ts`
(`lib/security-headers.ts`). Matcher exclusions, the per-mode meeting origin
(8x8.vc for JaaS, the self-hosted Jitsi host, none for meet.jit.si), and Jitsi
regression requirements are in spec 13.

PR findings gate merges. Main/scheduled scanner findings are generally reported
for triage, while dependency audit remains failing on every trigger and the RLS
guard reports rather than blocks on main. Actions and the Semgrep container are
pinned for supply-chain stability.

CI placeholder environment values are build-only and do not exercise Supabase
or email providers.

## Database and spec review checklist

- Forward numbered migration; never edit applied SQL.
- RLS enabled, policy/service posture reviewed.
- Constraint backs uniqueness/concurrency claim.
- DAL owns table query and normalizes errors.
- Role/tenant derived server-side.
- Public capability has randomness/MAC, expiry/revocation posture documented.
- Personal data and export fields enumerated.
- External effects have explicit ordering, retries, and idempotency.
- Exact time/denominator/status rules tested.
- Relevant specs and `CLAUDE.md` remain consistent.
- Full verification command succeeds.
