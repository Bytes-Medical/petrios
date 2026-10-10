# Petrios product roadmap — killer-platform ideas

> Living ideas document, not a commitment. Generated from a structured multi-lens
> ideation review (July 2026): six perspectives — trainee pull, moderator
> workload, institutional buyers, open-platform moat, AI differentiation,
> trust-to-trust growth — followed by an adversarial critique pass. 40 candidate
> ideas went in; the 11 below survived. Licensed CC-BY-SA 4.0 like the rest of
> the docs.

## Strategic thesis

Petrios's compounding wedge is not any single feature but its **governed
evidence chain**: append-only, multi-source, provenance-labelled attendance with
numbered finalized revisions, welfare-screened feedback, and Ed25519 signing
with public verify pages. A product built on an editable register cannot
retrofit that — provenance has to be collected from the start.

The strategy is to convert that one chain into the career- or
governance-critical artifact **each role in the ecosystem is judged on**:

- the trainee's defensible *"attended X% of attendable"* number,
- the consultant's signed teaching-hours statement for appraisal and SPA
  reviews,
- the DME's panel-defensible governance pack for GMC and deanery scrutiny.

Each artifact requires zero behaviour change from its recipient, each carries a
verify link that markets the platform outward, and each converts a different
constituency into an internal champion. Network-dependent plays (federation,
benchmarking, marketplaces) are sequenced strictly behind this: first delete the
toil the governance itself creates, then arm every role with their artifact,
and only then let the artifacts and slots travel across trusts — with the
deanery, not the department, as the anchor tenant that solves cold start by
contract rather than by hope.

## Tier 1 — Quick wins (days to ~2 weeks)

### 1. Signed Consultant Teaching-Hours Statement ⭐ top pick

Extend the existing teacher appraisal dossier into a date-bounded,
Ed25519-signed annual teaching statement per consultant/SAS doctor — sessions
delivered, hours, feedback summary, public verify link — sized for medical
appraisal and job-plan/SPA reviews.

- **Why killer**: consultants and SAS doctors need teaching evidence every
  appraisal year and currently reconstruct it from memory; learner-centric
  platforms don't model teachers as evidence subjects at all. Zero behaviour
  change for the recipient, and it arms the most senior, most DME-adjacent
  people in the hospital with a personal reason to defend the platform.
- **Builds on**: teacher appraisal dossiers (spec/08), teacher
  assignments/certificates (spec/05), `lib/federation.ts` signing,
  `/verify/record`.
- **First step**: date-range parameter + canonically-signed export in
  `app/actions/portfolio.ts` / `lib/portfolio/*`, signed with
  `INSTANCE_SIGNING_KEY`, verified through the existing `/verify/record` page.

### 2. Post-Session Reconciliation Autopilot

One screen after each session: expected roster vs collected evidence, one-click
bulk moderator confirmation for stragglers, then approval-gated Ops emails
offering remaining absentees a remedy (submit evidence or complete Recall
catch-up) before finalizing the revision from the same screen.

- **Why killer**: it pays down the admin toil Petrios's own governance creates —
  the retention risk of every evidence-based product — and only Petrios can send
  an absence email that offers a legitimate catch-up path instead of an
  accusation, because only Petrios has Recall and audit-proof numbered
  revisions.
- **Builds on**: attendance policy-v2 RPC + roster finalization (spec/03),
  Petrios Recall, Ops approval queue (`ops_pending_actions`,
  `lib/ops/executors.ts`).
- **First step**: reconciliation server component joining expected-roster rows
  against `attendance_evidence`; bulk-confirm action inserting
  `MODERATOR_CONFIRMATION` through the existing transactional RPC; absentee
  chase drafts into the Ops approval queue.

### 3. Rota-aware teaching (rota integration; Phase 1 built, off by default)

The first integration with the trust rota. The rota coordinator uploads a CSV
export weekly; it is mapped **in the browser**, so Petrios receives only a
per-day status letter (A/D/N/X/L, no leave category) for matched trainees and
keeps only a "rostered unavailable" flag per session. After a session ends the
moderator's Expected roster panel suggests "excused (rostered unavailable)",
confirmed one row at a time; excused trainees keep the Audio Recap catch-up
(migration 064). Kill switch, per-org DPIA gate, automatic retention purge.
Spec: `spec/14-rota-availability.md`; operator guide: `docs/rota.md`.

- **Why killer**: missed-teaching unfairness is the loudest ARCP-visible trainee
  grievance. Moderator gatekeeping and the trainee contest keep a human in
  every decision, while the browser-side minimisation and deletion schedule make
  it something a trust IG team can approve. The append-only trail keeps the
  excused number defensible.
- **Remaining phases**: Phase 2, scheduling availability counts (banded, no
  names, per rota scope); Phase 3, a signed push API so a trust can automate the
  weekly export from inside its own network.
- **Fallback**: the earlier consent-based design, a trainee-raised "rota clash"
  flag that a moderator acknowledges as `EXCUSED`, remains the option for
  organisations that cannot get IG approval for the rota upload. It is not
  built.

## Tier 2 — Strategic bets (weeks to ~2 months)

### 4. One-Click GMC Teaching Governance Pack

A date-bounded, department- or trust-scoped dossier the DME generates before a
GMC National Training Survey window or deanery quality visit: full session
ledger with provenance-labelled finalized attendance, feedback trends, equity
gaps plus actions taken — issued as a signed, hash-stamped PDF/CSV with a
public verify code.

- **Why killer**: the red-outlier-with-two-weeks-to-respond moment is the
  highest-stakes recurring institutional pain, and only an append-only evidence
  chain produces numbers that survive hostile panel scrutiny — a backfillable
  register structurally cannot. "Panel-defensible in one click" is the sentence
  that makes a DME sign. The current audit PDF is capped at 15 sessions and
  unsigned (spec/12), so the gap is real even internally.
- **First step**: uncapped date-bounded governance query in `lib/db/audit.ts`,
  a `generateGovernancePack` action producing the signed PDF via the
  `@react-pdf` pipeline, and a `/verify/report/[code]` public route.

### 5. Programme Readiness Board with Ops Auto-Chase

A per-term pipeline view showing every upcoming session as traffic lights —
speaker confirmed, slides uploaded, room/Meet link set, feedback QR live,
reminder queued — with Ops drafting the next escalation into the approval queue
when a light stays red inside a lead-time window.

- **Why killer**: speaker-and-logistics chasing is where the med-ed fellow's
  unpaid hours actually go and no incumbent even models it; every readiness
  signal already exists as structured state, and the human-approval gate keeps
  automated chasing inside NHS IG comfort. Deletes the tracking spreadsheet
  every fellow secretly maintains.
- **First step**: per-session readiness query in `lib/db/ops-reads.ts`, board
  page under `/departments/[id]`, extend the `ops-weekly` cron for red-light
  chases, with a per-session "no slides expected" override to prevent
  false-positive noise.

### 6. Fair-Denominator Attendance ("attended X% of attendable")

Dated membership windows so a trainee's record stops counting sessions from
before they rotated in (a distortion spec/08 documents), combined with
moderator-confirmed excusals (rota-aware or manual), so progress records and portfolio packs report
*"attended X% of attendable sessions"* with visible excusal provenance.

- **Why killer**: turns ARCP fairness from a plea to the TPD into a verifiable
  number, which no spreadsheet or course-delivery LMS can produce because they
  lack an evidence pipeline and a governed catch-up path.
- **First step**: effective-date windows (joined_at/left_at) on department
  membership, filter the expected-session denominator in the `lib/portfolio`
  progress-record queries, surface the fair percentage in pack PDFs.

### 7. Appraisal Season Autopilot

One approval-gated Ops run each spring emails every faculty member and external
speaker their signed teaching-hours statement through the per-recipient delivery
ledger, plus an organiser-leadership dossier for the med-ed fellow's own
appraisal and fellowship case.

- **Why killer**: zero-effort delivery to a constituency incumbents don't serve,
  riding the exact Ops invariants (approved-action-only sends, delivery ledger)
  already built for newsletters — and every emailed verify link lands in front
  of an appraiser at a trust that may not run Petrios yet.
- **First step**: `appraisal_pack` purpose in the Ops gateway allow-list, batch
  action drafting one `ops_pending_actions` row per recipient, sends through
  `lib/ops/executors.ts` mirroring the newsletter ledger pattern.

### 8. Regional Speaker Exchange

Departments publish open and lightning slots to a shared regional board — a
public page listing claimable teaching opportunities across participating
departments. Consultants and senior trainees claim via the existing `/claim`
flow, deliver via Petrios Meet if remote, and walk away with an
attendance-governed certificate.

- **Why killer**: it matches the two most reliable motivations in the
  ecosystem — fellows desperate for speakers and senior trainees desperate for
  portfolio teaching evidence — on rails that already exist end-to-end. A
  scheduling tool can't issue governed certificates and no LMS lets outsiders
  claim anything. One seeded anchor programme bootstraps it.
- **First step**: public-listing flag on slot publications in
  `lib/db/teaching-slots.ts`, regional board entity migration, public board
  route linking into `/claim/[code]`.

## Tier 3 — Moonshots (months, category-defining)

### 9. National Teaching Marketplace

Grow the regional board into a cross-instance two-sided marketplace: any
Petrios instance publishes claimable slots to a federated index, claimants
build a verified delivery history from governed certificates, and departments
recruit from a standing supply of proven speakers.

- **Why killer**: marketplaces are winner-take-most; every claim onboards an
  external clinician at zero acquisition cost, and each new instance adds supply
  and demand simultaneously — a network effect a per-employer-licensed product
  cannot copy without abandoning its business model.
- **First step**: extend `/.well-known/petrios` to advertise a signed
  public-slots feed, plus a verified cross-instance fetcher (reusing
  `lib/federation.ts` signature verification and the `lib/webhooks.ts` SSRF
  guard) rendering remote claimable slots on the regional board.

### 10. Deanery Anchor: oversight tier + federated benchmarking in one contract

A read-only deanery layer that rolls up member trusts via explicitly granted
scoped API tokens, shipped together with spec/10 benchmarking so the deanery's
own onboarding seeds k≥5 comparable instances on day one — converting
benchmarking's cold-start problem from an organic hope into a procurement
event.

- **Why killer**: deanery-level money exists where department budgets don't,
  and centralized products cannot offer cross-trust comparison without becoming
  data controller for every trust — an IG non-starter — while pull-based signed
  aggregates with k-anonymity are DPIA-passable by design. One signed deanery
  makes Petrios the default for every trust beneath it.
- **First step (independently shippable)**: the spec/10 publication side only —
  an opt-in signed monthly aggregate document at a well-known route, computed
  from `lib/db/audit.ts` metrics with the shared k=5 suppression constant.

### 11. Trainee Career Record (same-instance-first passport)

A lifetime "My Career" view aggregating a trainee's verified attendance,
reflections, and certificates across every organization they have belonged to,
with cross-instance signed-record import as the ceiling. On a hosted
multi-tenant instance, a trainee's next trust is frequently just another org on
the same database — so same-instance continuity delivers standalone value with
zero network precondition, and federation import ships only when instance
density earns it.

- **Why killer**: record fragmentation across employers is the structural pain
  per-employer-licensed products can never fix, and every rotation becomes a
  sales event once trainees carry a living record their next trust is asked to
  honour. The signing rails already exist; the moonshot is adoption sequencing,
  not invention.
- **First step**: make the progress-record queries in `lib/portfolio/*` span
  all organizations the authenticated user belongs to (they are currently
  current-org-scoped per spec/08) and render a "My Career" timeline, before
  touching any cross-instance import.

## Ideas considered and deliberately parked

Recorded so they aren't re-litigated from scratch:

- **Passport/rotation-transfer as a near-term feature** — the signed
  verify-linked pack already ships and does the ARCP job; the import half is
  worthless until other trusts run Petrios. Parked behind adoption (see #11 for
  the sequencing that works).
- **Server-side rota ingestion / live rota query / clash-aware "reach
  scores"** — rostering data is jealously guarded, trust informatics queues run
  in years, a live query needs an inbound trust endpoint, and roster exports are
  dirty; a confident-looking score built on a garbage denominator is worse than
  none. Rota integration is now #3, deliberately built the other way round:
  browser-side minimisation of a coordinator's export, human confirmation of
  every excusal, and banded counts (Phase 2) rather than scores. The manual
  clash flag stays the fallback where IG approval is not available.
- **Benchmarking-first** — statistically misleading below ~5 comparable peers
  and no DME can take a median of three self-selected early adopters to an
  education committee. Sequenced behind the deanery anchor (#10).
- **DTAC/DPIA pack generators** — standard procurement collateral every serious
  supplier provides; the genuine differentiators (inspectable AGPL code,
  own-tenancy self-hosting, pinnable AI endpoints) already exist as shipped
  capability.
- **Spaced-repetition revision streams / teaching podcast** — trainee revision
  attention is ruthlessly captured by commercial exam question banks; local
  departmental content cannot win that war and doesn't need to.
- **AI-drafted reflections and ARCP narratives, NTS prediction** — reflective
  records are legally sensitive territory, deaneries actively warn against
  AI-generated portfolio text, and survey prediction is unvalidated correlation.
  The platform's AI stays document-led, approval-gated, and never evaluates
  trainees.

## Recommended sequence

1. **Now**: Signed Consultant Teaching-Hours Statement (#1) — days of work,
   manufactures champions.
2. **Immediately after**: Reconciliation Autopilot (#2) and the rota-aware
   teaching pilot (#3; Phase 1 built, waiting on a trust DPIA) — retention and
   fairness.
3. **Following month(s)**: GMC Governance Pack (#4, the institutional buying
   trigger), Readiness Board (#5), Fair-Denominator (#6), Appraisal Autopilot
   (#7, spring deadline), Regional Speaker Exchange (#8).
4. **When adoption earns it**: marketplace federation (#9), deanery anchor
   (#10), career record (#11).
