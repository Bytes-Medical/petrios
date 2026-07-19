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
| `spec/` | Detailed implemented contract and explicitly labelled RFCs |

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
8. return a small serializable result.

If side effects are intentionally nontransactional, state which durable result
survives failure. Catching an error is not idempotency.

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

Current cron families:

| Route | Primary idempotency |
|---|---|
| `session-reminders` | Session `reminder_sent_at` watermark |
| `post-session-reports` | Session report watermark plus selected certificate/evidence checks |
| `recall-send` | Per-recipient catch-up invite delivery plus set watermarks; watermark closes only after all eligible sends |
| `recall-awards` | Unique completion/certificate plus claimed `ATTENDANCE_CERTIFICATE` delivery |
| `ops-weekly` | Pending-action dedupe, chase counts, Ops memory; low-score notification has no dedupe |
| `ops-synthesis` | Unique synthesis and Recall set per session |

Newsletters are not cron routes. Moderator generation is unique per
organization/department/week, and delivery idempotency is per issue/member with
a revision-bound claim ledger.

Watermark timing matters. Recall invitation delivery deliberately keeps the set
open after any missing profile/provider/ledger failure, while successful
recipient rows skip on retry. Other jobs may retain different explicitly
documented partial-failure behavior; preserve or deliberately redesign the
relevant contract.

## Time and date rules

- Store instants as Postgres timestamps/ISO strings.
- Parse/compare on the server using `Date` only after invalid-date checks.
- Specify which session edge a rule uses (`date_start` or `date_end`).
- Specify inclusive versus exclusive endpoints.
- Use `??` when zero is a valid setting; `||` changes zero into a default. Some
  current group-code/feedback selectors use `||`, and their specs call that out.
- Use shared pure helpers for calculations that appear in both jobs and actions.
- Formatting for email/PDF/UI may use British locale, but formatted strings are
  never comparison keys.

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
recipients with one controlled address. `EMAIL_DEV_MODE=true` logs metadata even
in production-like mode; it does not itself select a transport. Attachments are
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

- General chat completions use `lib/ai/llm.ts`.
- Ops inference uses `lib/ops/gateway.ts` and its purpose allow-list.
- The Ops tool loop is the sole sanctioned direct chat-completion caller outside
  the general adapter.
- Speech uses only `lib/ai/tts.ts`. Provider-specific headers, endpoints,
  defaults, errors, and metadata stay behind that boundary; actions must not
  branch directly on OpenAI or ElevenLabs.
- Model output is untrusted: validate schema, enforce length/content rules, and
  never derive tenant/authorization from it.
- Feedback/user content must be labelled and fenced as data. The regular
  on-demand feedback summary is a known weaker path documented in spec 05.
- Prompt/run logs store hashes and operational metadata, not raw feedback or
  secrets.

## UI conventions

Petrios uses a restrained monochrome, monospaced visual language with clear
borders, compact status chips, and responsive server-rendered pages. Continue to
use the shared primitives (cards, buttons, wordmark, form controls, navigation)
and existing label maps instead of one-off styling/status strings.

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
  (`SessionCalendarLazy`, `JitsiMeetingPanel` pattern), never statically
  from a page.
- **Dense management pages use collapsible sections**
  (`components/SettingsSection.tsx` — a native <details> styled like Card,
  server-renderable, counts in the header, optional internal scroll) laid
  out in a two-column grid, so pages read as compact section lists instead
  of one long scroll.

## Test strategy

### Unit tests

Vitest runs `vitest run`. Pure domain modules colocate tests, including attendance
windows/priority, Recall analytics/tokens, federation signing/canonicalization,
cron auth, Ops anonymization/synthesis/newsletter, slot helpers, and other
deterministic behavior.

For a stateful flow, extract and test the pure decision separately, then add
database/integration coverage where constraints/RLS are the real guarantee. Test
exact boundaries and negative cases, not only representative success.

### Browser smoke tests

Playwright starts the public app with placeholder Supabase/config and Chromium.
The current suite is unauthenticated and focuses on public/responsive surfaces;
it is not proof of authenticated RLS or end-to-end email/database behavior.

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

Browser-facing responses additionally receive the global HSTS, CSP,
anti-framing, MIME, referrer, permissions, and cross-domain-policy baseline from
`next.config.js`. CSP origin and Jitsi regression requirements are in spec 13.

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
