# Petrios platform specification

This directory is the detailed, implementation-facing specification for
Petrios. It describes the application represented by the source tree and by
database migrations through `052_certificate_branding_and_coordinators.sql`. `CLAUDE.md` is the short
architecture briefing; these documents are the durable contract for maintainers,
reviewers, operators, and coding agents.

The source code remains authoritative when investigating an incident. A
contradiction between source and spec is nevertheless a defect: either the code
has drifted from an intended invariant or this directory has not been updated.
Resolve the contradiction in the same change that discovers it.

These specifications are licensed under
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Independent,
compatible implementations may use them with attribution to Petrios and under
the share-alike terms. The application source is separately licensed under
AGPL-3.0-or-later; see `LICENSE` and `NOTICE`.

## How to read the specification

Each document distinguishes four kinds of statement:

- **Invariant**: a property that must continue to hold. A change that violates
  one is a defect unless the invariant is deliberately redesigned and the code,
  tests, migration, and specification change together.
- **Implemented behaviour**: what the current application actually does,
  including failure and retry behaviour.
- **Current limitation**: a known gap, weak boundary, or surprising behaviour.
  These are documented to prevent callers from assuming a stronger guarantee.
- **RFC**: a future protocol or design. RFC text is not a statement that the
  corresponding route, table, or workflow exists.

Terms such as “public”, “authenticated”, and “service role” describe access
boundaries, not sensitivity. A public capability URL can still expose personal
data to whoever possesses it.

## Contents

| Spec | Primary contract |
|---|---|
| [01 — Architecture](./01-architecture.md) | Runtime stack, trust boundaries, layering, tenancy, authorization, routing, and configuration |
| [02 — Data model](./02-data-model.md) | Migration discipline, table families, relationships, RLS strategies, and data-access ownership |
| [03 — Attendance](./03-attendance.md) | Append-only evidence, secure check-in, deterministic derivation, roster finalization/revision, correction, and notifications |
| [04 — Sessions and scheduling](./04-sessions-and-scheduling.md) | Session lifecycle, teacher assignment, private documents, invitations, calendar feeds, slots, claims, and reminders |
| [05 — Feedback and certificates](./05-feedback-and-certificates.md) | Identified feedback, privacy-processed analytics/report release, delivery claims, canonical certificate eligibility/revocation, and branded coordinator snapshots |
| [06 — Petrios Ops](./06-petrios-ops.md) | AI operations layer, inference audit, approval gate, assistant tools, jobs, and audio recap approval |
| [07 — Engineering conventions](./07-conventions.md) | Code boundaries, validation, errors, email, jobs, testing, CI, and change procedure |
| [08 — Portfolio and Recall](./08-portfolio-and-recall.md) | Passport, durable portfolio snapshots, teacher dossier, recall questions, analytics, and catch-up learning completion |
| [09 — API, federation, and self-hosting](./09-platform-api-and-self-hosting.md) | Bearer API, webhooks, portable signed records, provider adapters, deployment, health, and environment variables |
| [10 — Federated benchmarking](./10-federated-benchmarking.md) | **RFC, not implemented:** opt-in, signed, aggregate-only cross-instance comparison |
| [11 — Identity and administration](./11-identity-and-administration.md) | Login methods, signup posture, join workflow, profiles, memberships, roles, and administrator surfaces |
| [12 — Audit and reporting](./12-audit-and-reporting.md) | Audit scope, metric denominators, equity views, member reports, exports, and privacy caveats |
| [13 — Privacy, security, accessibility, and compliance](./13-privacy-security-and-compliance.md) | Public disclosures, data map, cookies/GPC, provider transparency, browser headers, contrast, and operator evidence boundary |

## Non-negotiable invariants

The subsystem documents supply the precise scope and exceptions. This summary
must not be used to erase those details.

1. **Data-plane access is owned by `lib/db/`.** Components, route handlers,
   cron handlers, and server actions use DAL functions instead of querying
   tables directly. `lib/auth.ts` is the deliberate authorization-seam
   exception and performs membership reads. Auth-plane `supabase.auth.*` calls
   are separately allow-listed by ESLint. Any new exception is a review decision.
2. **Attendance evidence is append-only and results are derived.** Application
   and RLS paths do not update/delete evidence or hand-edit a finalized result.
   Corrections append a reasoned moderator observation; parent lifecycle deletes
   may still cascade as declared in schema.
3. **Finalized attendance is revisioned recognition input.** Evidence cannot be
   added while finalized. A moderator must reopen with a reason, which revokes
   canonical certificates, then re-finalize a complete roster as a new revision.
   Feedback, Recall, and teaching assignment are not policy-v2 attendance.
4. **Petrios Ops cannot send unapproved email.** Every Ops-originated outbound
   email must be represented by an approved `ops_pending_actions` row and sent
   through `lib/ops/executors.ts`. Core deterministic mail such as authentication,
   invitations, reminders, certificates, and Recall is outside the Ops subsystem
   and follows its own explicitly documented trigger.
5. **Ops inference is constrained and auditable.** It uses the purpose allow-list,
   stores hashes rather than prompt text in its run log, treats feedback as
   untrusted data, and does not evaluate individual trainee performance.
6. **`OPS_ENABLED=false` disables every Ops surface.** Jobs no-op, inference and
   actions refuse work, and audio-recap delivery is unavailable.
7. **Public and token-authenticated routes authorize themselves.** The routing
   proxy deliberately bypasses all `/api/*` paths. A route must not rely on the
   proxy to establish either a browser session or an organization.
8. **Tenant scope comes from trusted context.** It is derived from a membership,
   API token, invite/claim capability, or the cron's enumerated organization—not
   from an unchecked model response or request-body `org_id`.
9. **Migrations move forward.** Applied numbered migrations are not edited.
   Schema changes use the next unique `NNN_snake_case.sql` file, enable RLS on
   new tables, and deliberately choose policies or deny-all service access.
10. **Moderator authority belongs to one organization.** A user may hold
    `department_admin` memberships in multiple departments of one organization,
    but granting that role in another organization demotes their prior moderator
    roles to `faculty`. Ordinary membership is preserved.
11. **Specifications change with behaviour.** New status values, access paths,
    delivery guarantees, data retention, privacy boundaries, or failure modes
    require a same-change update here.
12. **Compliance claims remain evidence-bound.** Missing controller, location,
    transfer, retention, contract, security, or accessibility facts stay visible;
    scanner scores and repository controls are not represented as certification.

## Change protocol

Before modifying a subsystem:

1. Read `CLAUDE.md`, this file, and every linked subsystem spec.
2. Locate the owning server action or route, DAL module, migration constraints,
   RLS policies, background jobs, email/webhook side effects, and tests.
3. Decide whether the proposed guarantee is enforced in the database, on the
   server, only in the UI, or not at all. Document that enforcement level.
4. Preserve idempotency and failure semantics. A “best-effort” side effect must
   not be rewritten in prose as transactional or guaranteed.
5. Add a forward migration where storage or policy changes. Never rewrite a
   migration that may already have run.
6. Update the affected specification and, if the cross-cutting boundary changes,
   this index and `CLAUDE.md`.
7. Run `s/lint && s/typecheck && s/test && s/build`; run the relevant Playwright
   smoke tests when a public/browser journey changes.

## Documentation accuracy rules

- Describe observed enforcement, not UI intention. For example, source feedback
  is not anonymous when the server stores submitter identity, even though the
  teacher-release path omits it.
- Name the time reference and boundary (`date_start`, `date_end`, inclusive or
  exclusive) for every window.
- State which actor may call a flow, which tenant is used, and how the subject is
  identified.
- State whether retries, deduplication, uniqueness, revocation, or expiry exist.
  Silence must not be interpreted as a guarantee.
- Call out legacy or dormant schema rather than presenting it as an active path.
- Keep future design in an explicitly labelled RFC section or file.
