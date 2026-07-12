# DTAC self-assessment — Petrios

A working self-assessment against NHS England's **Digital Technology
Assessment Criteria (DTAC)**, for trusts evaluating a self-hosted Petrios
deployment. This is a starting pack, not a completed assessment:
sections marked *[deployment-specific]* depend on how and where you host it.
Verify against the current DTAC version before submission.

## A. Clinical safety (DCB0129/DCB0160)

- Petrios is a **teaching administration** tool: it manages teaching
  sessions, attendance evidence, feedback, and certificates. It does not
  process patient data, provide clinical decision support, or influence
  direct care — trusts should confirm their own DCB0160 scoping, but the
  typical determination for administrative education tools is out of scope
  for clinical safety cases. *[deployment-specific]*
- The AI layer never evaluates trainee performance, and anonymous feedback
  containing welfare/safety signals is deterministically routed to humans
  and excluded from AI summaries (`spec/06-bytes-ops.md`, safety rails).

## B. Data protection

- Personal data processed: staff/trainee names, work emails, grades,
  attendance records, teaching feedback (anonymous by design), certificates.
  No patient data; no special-category data by intent (free-text feedback is
  monitored by welfare-signal rails and routed to humans).
- A pre-filled DPIA template is provided:
  [`dpia-template.md`](./dpia-template.md).
- Self-hosting keeps all data inside your estate; the optional AI features
  can be pointed at an in-network model via `OPENAI_BASE_URL` or disabled
  entirely (unset the key / `OPS_ENABLED=false`).
- Data subject rights: all state is in Postgres with per-user keys —
  export and erasure are straightforward SQL/API operations.
  *[deployment-specific: your retention schedule]*

## C. Technical security

- Row Level Security on every table; sensitive tables are deny-all with
  access only through an audited service layer (`spec/02-data-model.md`).
- Secrets are environment-only; the repository is verified secret-free and
  CI enforces it (TruffleHog, CodeQL, Semgrep, dependency audit, and an RLS
  guard on every PR — `SECURITY.md`).
- API access uses hashed org-scoped bearer tokens; webhooks are HMAC-signed
  with SSRF protections. AI prompt text is never stored (hashes + token
  counts only).
- Vulnerability reporting: private disclosure via GitHub
  (`SECURITY.md`). Dependency updates via Dependabot; production
  dependency audit fails CI on high+ advisories.
- Authentication: Supabase Auth (email); deploy behind your SSO/reverse
  proxy as required. *[deployment-specific]*

## D. Interoperability

- REST API with OpenAPI 3.1 schema (`/openapi.json`), org-scoped tokens.
- Signed webhooks for event integration (`docs/api.md`).
- iCalendar feed for calendars; CSV exports for attendance/equity;
  signed portable teaching records (federation, `spec/09`).
- Open source (AGPL-3.0) — no vendor lock-in; data lives in standard
  Postgres.

## E. Usability & accessibility

- Responsive web UI; keyboard-focus styles and reduced-motion respected in
  the design system. A formal WCAG 2.2 audit has not yet been performed —
  track via the project ROADMAP. *[deployment-specific: assistive tech
  testing in your context]*
