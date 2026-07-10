# 07 — Conventions

## Code

- Server actions (`'use server'`) start with auth (`requireAuth` /
  `requireOrg` / `requireDepartmentModerator` / `requireOpsManager`), then
  orchestrate DAL calls, then `revalidatePath`. Business logic that is pure
  belongs in `lib/` modules, not action files or routes.
- DAL functions that run as the system (crons, claim flows) carry an
  `…AsSystem` suffix or a module-level service-role justification; every
  throw site normalises through `toDbError`.
- Shared helpers exist — reuse before writing: label maps + types
  (`lib/types.ts`), `cn` + `fieldStyles` (`lib/utils.ts`), date helpers
  (`lib/date-picker.ts`), ops formatters (`lib/ops/format.ts`),
  `profileDisplayName`/`contactDisplayName` (`lib/contacts.ts`),
  `generateCode` (`lib/codes.ts`), `sessionMeetingUrl` (`lib/jitsi.ts`),
  `unauthorizedCronResponse` (`lib/cron-auth.ts`), `unwrapEmbed`
  (`lib/db/unwrap.ts`).
- LLM access: only `lib/ai/llm.ts` (and the sanctioned tool loop in
  `lib/ops/agent-loop.ts`) may call the OpenAI API. Raw `fetch`, no SDK —
  same reasoning as email below.

## UI (neo-brutalist design system)

- IBM Plex Mono everywhere (`font-mono`), warm ink `#1F1D1A`, paper
  background, terracotta `clay-600` accent, **hard offset shadows**
  (`shadow-[3px_3px_0_#1F1D1A]`), square corners, `border-black`.
- Primitives are cva-based: `Button` (primary/secondary/danger/ghost ×
  sm/default/lg), `Card` (default/raised), `Badge`, `Input`, `Select`,
  `Textarea`. New variants go inside the cva config, not ad-hoc classNames.
- Popover/dropdown dismissal via `hooks/useDismissable`; approval
  review state via `hooks/useOpsReview`.
- Labels render from the maps in `lib/types.ts`; status → Badge variant
  maps are local per domain.

## Email

- `lib/email.ts` is a provider-neutral adapter over Resend's REST API via
  `fetch` (deliberately no SDK): `getEmailClient().emails.send({from, to,
  subject, html, attachments?})`, `getFromAddress()`. Dev behaviour: no
  `RESEND_API_KEY` → console log-sink; `MAIL_DEV_REDIRECT` funnels all mail
  to one inbox.
- Templates: `lib/email-templates.ts` (+ `lib/ops/email-html.ts` for
  ops-drafted mail). Mono/inline-style HTML matching the app. All dynamic
  text is escaped (`escapeHtml`); LLM-drafted bodies are plain text that
  gets escaped and wrapped — never raw HTML.
- Per-recipient send loops with non-fatal try/catch; app URLs via
  `getAppUrl()` (`lib/app-url.ts`), never hardcoded.

## Notifications

`lib/notify.ts notifyUser({orgId, userId, notification, email?})` — bell row
(service-role insert) plus optional email, both best-effort/non-fatal.
Recipients read/mark their own rows (RLS). `NavShell` server-fetches the
bell (and, for org managers, the ops approvals bell) on every page.

## Cron routes

`app/api/cron/<name>/route.ts`, GET, authenticated by
`unauthorizedCronResponse(request)` (`?secret=CRON_SECRET`). Idempotency is
mandatory: watermark columns (`report_sent_at`, `reminder_sent_at`), UNIQUE
constraints (synthesis per session, newsletter per org+week), or window
maths. Batch caps keep runs inside serverless limits; per-item failures are
logged and skipped, never abort the batch. Ops crons additionally check the
kill switch and log to `ops_agent_runs`.

## Testing & verification

- Vitest, pure logic only, colocated `lib/**/*.test.ts` — no network, no
  Supabase, no LLM calls in tests. Anything with I/O gets its pure core
  extracted into `lib/` and tested there.
- Local verification sequence: `npx tsc --noEmit && npm run lint && npm test
  && npm run build`. **Stop the dev server before `npm run build`** — a
  build over a live dev server corrupts `.next` (then `rm -rf .next` and
  restart).
- CI runs lint, type-check, tests, build, and a migration numbering check.

## Git

- Commit per feature with detailed bodies; never push unless explicitly
  asked. Migrations are applied by the maintainer, not CI.
