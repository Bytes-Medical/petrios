# Petrios — Platform Specification

Detailed specs of how this platform is built, written primarily for LLMs
(and humans) working on the codebase. `CLAUDE.md` at the repo root is the
compact per-session entry point; these documents carry the depth.

**Rule of use:** when a change touches a subsystem, read its spec first and
update the spec in the same PR if behaviour changes. A spec that contradicts
the code is a bug in the spec.

**License:** these specifications are licensed under
[CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) — you are
welcome to build independent, compatible implementations of what they
describe, with attribution ("Petrios"), share-alike. The Petrios source
code itself is separately licensed under AGPL-3.0-or-later (see the
repository `LICENSE` and `NOTICE`).

## Contents

| Spec | Covers |
|---|---|
| [01-architecture.md](./01-architecture.md) | Stack, layering rules, auth model, multi-tenancy, middleware |
| [02-data-model.md](./02-data-model.md) | Tables, RLS strategies, migration conventions |
| [03-attendance.md](./03-attendance.md) | Evidence-based attendance pipeline |
| [04-sessions-and-scheduling.md](./04-sessions-and-scheduling.md) | Sessions, teacher invitations/RSVP, teaching slots, Petrios Meet video |
| [05-feedback-and-certificates.md](./05-feedback-and-certificates.md) | Anonymous feedback, AI summaries, certificates + verification |
| [06-petrios-ops.md](./06-petrios-ops.md) | The AI agent layer: invariants, approval gate, gateway, crons, assistant |
| [07-conventions.md](./07-conventions.md) | Code, UI, email, notification, cron, and testing conventions |
| [08-portfolio-and-recall.md](./08-portfolio-and-recall.md) | Evidence Engine (ARCP packs, teacher dossiers) + Petrios Recall with catch-up attendance |
| [09-platform-api-and-self-hosting.md](./09-platform-api-and-self-hosting.md) | Public API + webhooks, federation, provider adapters, deployment |
| [10-federated-benchmarking.md](./10-federated-benchmarking.md) | RFC (not implemented): opt-in, signed, aggregate-only cross-instance benchmarking |

## Non-negotiable invariants (summary)

The long-form rationale lives in the individual specs; violating any of
these is a defect regardless of what a task seems to require:

1. **All data-plane Supabase access goes through `lib/db/`** — server
   actions and components never import Supabase clients for queries
   (auth-plane `supabase.auth.*` calls are the only exception).
2. **`attendance_evidence` is append-only**; `attendance` is derived and
   recomputable, never hand-edited, and locking freezes it.
3. **No Petrios Ops outbound email without an approved `ops_pending_actions`
   row** — `lib/ops/executors.ts` is the only ops send path.
4. **All LLM traffic goes through `lib/ai/llm.ts`** (plus the one sanctioned
   tool-loop in `lib/ops/agent-loop.ts`), and within Petrios Ops through the
   `opsInference` gateway with its purpose allow-list and hash-only audit.
5. **`OPS_ENABLED=false` halts every ops surface.**
6. **Feedback free text is untrusted input** — always fenced as data in
   prompts, never interpreted as instructions; ops never evaluates trainee
   performance.
7. **Migrations are additive and numbered** — never edit an applied
   migration; new ones only CREATE/ALTER forward.
