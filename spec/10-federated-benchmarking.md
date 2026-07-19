# 10 — Federated benchmarking (`petrios-benchmark/v1`)

> **Status: RFC — not implemented.** No current migration, route, setting,
> well-known field, job, UI, fetcher, cache, or comparison implements this
> protocol. This document is design input only. Shipped behavior is in spec 09.

## Problem and design intent

Independent Petrios deployments preserve local control and data residency, but
an organization cannot interpret an attendance or feedback figure against a
wider context. This RFC proposes opt-in publication of signed **organization-
level monthly aggregates** that another instance can fetch and compare without a
central service or per-person data.

The protocol deliberately provides context, not league tables. It must not be
used to rank individual trainees, teachers, departments, hospitals, or small
cohorts. A signature proves who signed bytes; it does not prove the underlying
measure was calculated honestly or comparably.

## Non-goals for v1

- No automatic participation or default-on sharing.
- No central Petrios registry, ingestion service, leaderboard, or telemetry.
- No per-person, per-grade, per-department, per-session, or daily output.
- No remote write/push between instances.
- No proof that an issuer used unmodified Petrios code.
- No differential privacy, secure multiparty computation, or federated model
  training.
- No historical permanence guarantee: publishers may stop serving a document.
- No use of benchmark results for automated communications, access, assessment,
  or performance decisions.

## Hard privacy and governance invariants

Any implementation must satisfy all of these before exposing a route:

1. **Explicit organization-admin opt-in, default off.** Enabling one metric must
   not enable another. Consent records who changed it and when.
2. **Organization-level calendar-month floor.** No department/site breakdown and
   no time resolution smaller than `YYYY-MM`.
3. **Aggregates only.** No user/session ids, names, emails, codes, free text,
   question text, quotes, exact timestamps, or joinable pseudonyms.
4. **No stable subcohort keys.** Consumers must not correlate a rare grade,
   specialty, or department across periods.
5. **Small-cohort suppression.** A score/rate is omitted when its relevant
   denominator is below the shared minimum threshold.
6. **Counts are an explicit disclosure choice.** Denominator counts can identify
   small programmes and must be reviewed, suppressed, or bucketed.
7. **Public-by-design review.** Every published value must be safe to put on a
   public poster. Signatures provide integrity, not confidentiality.
8. **No automated consequence.** Benchmarks are descriptive organizer context;
   model/tool decisions and trainee/faculty evaluation may not consume them.
9. **Revocable serving.** Disabling sharing stops future responses and removes
   discovery. Consumers label cached copies historical and apply retention.
10. **Local source transparency.** The UI shows formula, period, denominator,
    suppression, generation time, and limitations before opt-in.

The proposed threshold is the current `RETENTION_MIN_COHORT` value of 5. The
implementation must import/reuse one shared policy constant rather than copy the
number into routes. k=5 is only a basic inference bound: five identical outcomes
still reveal each participant's outcome.

## Proposed signed document

```json
{
  "format": "petrios-benchmark/v1",
  "instance": "https://teaching.example.nhs.uk",
  "public_key": "<SPKI DER base64>",
  "period": "2026-06",
  "generated_at": "2026-07-01T00:00:00.000Z",
  "metric_version": "petrios-metrics/1",
  "metrics": {
    "sessions_held": 14,
    "attendance_rate_pct": 71.2,
    "feedback_avg": 4.3,
    "recall_retention_median_pct": 78.0
  },
  "cohorts": {
    "attendance_n": 210,
    "feedback_n": 96,
    "recall_n": 41
  },
  "suppressed": [],
  "signature": "<Ed25519 signature base64>"
}
```

Required top-level fields:

| Field | Contract |
|---|---|
| `format` | Exact `petrios-benchmark/v1` |
| `instance` | Canonical HTTPS origin matching the publisher's well-known identity |
| `public_key` | SPKI DER base64 key advertised by that instance |
| `period` | Four-digit year and two-digit month; no day |
| `generated_at` | ISO timestamp for freshness/audit, not a source-event timestamp |
| `metric_version` | Exact formula suite identifier; comparisons require compatibility |
| `metrics` | Allow-listed finite numeric values only |
| `cohorts` | Allow-listed denominator disclosure; exact/bucket decision unresolved |
| `suppressed` | Allow-listed metric names withheld specifically for privacy threshold |
| `signature` | Ed25519 signature over the canonical document without this field |

Unknown fields should be rejected in v1 rather than silently signed/consumed.
All numeric values must be finite, nonnegative, and within metric-specific
bounds. Percentage/average fields use one decimal.

## Omission and suppression semantics

These states must remain distinguishable:

- **not opted in / not measured:** metric key absent and not in `suppressed`;
- **privacy-suppressed:** key absent and metric name present in `suppressed`;
- **published zero:** key present with numeric zero;
- **unavailable due to computation error:** publisher should fail generation or
  expose operational health separately, not publish zero.

Consumers display “not shared”, “withheld for small cohort”, and “0” differently.
They must never infer the suppressed denominator from neighbouring metrics.

## Proposed metric definitions

The exact definitions must be implemented as pure, versioned functions with
fixture tests shared by publisher and in-product reporting. Cross-instance
comparison is invalid when formula versions differ.

### `sessions_held`

Count sessions where:

- status is `PUBLISHED`; and
- `date_end` is in the calendar month interval `[monthStart, nextMonthStart)` in
  a documented timezone.

The RFC must choose UTC or an organization-configured reporting timezone before
implementation. Current organizations have no explicit reporting-timezone
contract, so this is unresolved.

`sessions_held` is a count rather than a score. Whether it needs suppression for
very small programmes remains a governance question.

### `attendance_rate_pct`

Proposed formula:

```text
100 * sum(attended expected-subject outcomes)
    / sum(all expected-subject outcomes)
```

where attended means `PRESENT` or `LATE` and sessions are the period's held
sessions.

This cannot be implemented from current raw `attendance` rows alone because
missing rows are not materialized absences and expected audience is not stored as
a session-time snapshot. Using current department membership would reproduce the
live progress record but can rewrite history. The RFC must choose and migrate a stable
expected-attendee definition before this metric is comparable.

`attendance_n` is the expected-subject outcome denominator, not number of unique
people or materialized rows.

### `feedback_avg`

Mean of each feedback submission's overall score using the same algorithm as
`getSessionFeedbackStats`: unrounded mean of valid rating answers, legacy stored
rating fallback, then equal weight per submission. Include feedback for held
sessions, regardless of submission timestamp, only after a defined cut-off (for
example generation at next-month day 2) so late feedback does not make the same
signed period nondeterministically drift.

`feedback_n` is scored submissions, not number of individual rating answers.

### `recall_retention_median_pct`

For each held session:

1. select `RETENTION` answers only;
2. require that session's retention cohort to meet the minimum;
3. compute its average percentage score; and
4. take the mathematical median of eligible session averages.

`recall_n` is proposed as total retention answers included. The document should
also reveal eligible session count only if doing so passes disclosure review.
Catch-up answers are excluded because they measure a different population.

The month cut-off and treatment of answers arriving up to 21 days later must be
fixed (e.g. generate only after the Recall window closes) or the metric will
change across regenerations.

## Signing and canonicalization

Reuse `lib/federation.ts` Ed25519 identity and canonical JSON algorithm:

1. construct a strictly schema-validated document without `signature`;
2. recursively sort object keys, preserve array order, emit no whitespace;
3. sign canonical UTF-8 bytes with the instance private key; and
4. append base64 signature.

The implementation must include canonical fixtures and cross-runtime test
vectors. A publisher must not sign `undefined`, `NaN`, infinity, locale-formatted
numbers, or unordered sets.

The existing key-rotation limitation applies: until well-known metadata can
advertise key ids/history, rotating the key makes historical documents lose live
key confirmation.

## Proposed storage and publication state

An implementation should not calculate sensitive aggregates on every public
request. Proposed local state:

- organization-level metric opt-in settings and audit actor/time;
- one immutable generated document per organization/period/metric version;
- generation status/error and source cut-off time;
- optional replacement relation for corrected documents; and
- publication enabled/disabled state independent of generation.

All tables enable RLS and should be deny-all/service accessed, with admin-gated
settings. A unique constraint covers organization, period, and metric version.
Regeneration must be an explicit correction with audit—not an unnoticed rewrite
under the same signature/URL.

Disabling publication should return 404 and remove discovery but may retain the
local audit row under the instance's retention policy.

## Discovery and transport proposal

Pull-based discovery avoids outbound disclosure and a central registry.

`/.well-known/petrios` could gain an optional field only when publication is
enabled:

```json
{
  "benchmark_index_url": "https://teaching.example/benchmarks/index.json"
}
```

An index should list a bounded number of periods, metric version, document URL,
and generation time without duplicating metrics. Documents are HTTPS GET,
public-cacheable with ETag, and size-limited.

Consumers:

1. accept an admin-configured peer origin rather than arbitrary model/user URL;
2. fetch well-known and index with strict HTTPS, timeout, response-size/content-
   type limits, no credentials, and safe redirect policy;
3. defend DNS and all IPv4/IPv6 private/link-local/metadata ranges against SSRF;
4. schema-validate before signature verification/display;
5. verify signature and live well-known key;
6. require compatible format/metric version/period; and
7. cache with fetch time, trust state, and retention expiry.

Given the current federation verifier's issuer-URL SSRF gap, no benchmarking
fetcher should reuse it unchanged.

## Comparison semantics

V1 is pairwise: local organization versus one explicitly configured peer. The UI
may show both values, denominators, suppression, formula version, and difference.
It must not label a side “better”, apply red/green performance judgment, or
average incomparable/suppressed metrics.

A future network aggregate needs weighting rules:

- unweighted instance mean overweights tiny publishers;
- denominator-weighted mean lets large instances dominate; and
- median instance value answers a different question.

No choice is implied by v1. A central community index/aggregation service would
be a separate governance and threat-model RFC.

## Threat model

| Threat | Required mitigation / residual risk |
|---|---|
| Forged document | Ed25519 plus trusted live issuer-key comparison; embedded key alone is not identity |
| Tampering/replay | Signature detects modification; period/generated time shown, but old valid documents remain replayable unless replacement/revocation exists |
| Dishonest metrics | Formula/version transparency and reputational trust; signatures cannot prove database truth |
| Small-cohort inference | Suppression and monthly org floor; k-anonymity remains limited |
| Differencing attacks | Stable monthly documents, no overlapping custom date queries, review metric combinations |
| Cross-period linkage | No subcohort keys; instance itself remains public/stable |
| SSRF | Admin allow-list, DNS-aware connect policy, redirect validation, egress firewall |
| Resource exhaustion | Peer count, response size, timeout, cache, job batch caps |
| Key theft | Server-only secret handling, rotation/history design, incident revocation plan |
| Benchmark misuse | UI language, permission boundary, no model/tools/automated decisions |

## Implementation acceptance criteria

This RFC may be marked implemented only when all of the following ship together:

- reviewed metric/denominator/timezone/cut-off definitions;
- admin opt-in per metric with audit and default off;
- forward migration with RLS/service DAL and immutable period documents;
- pure metric functions and fixture tests, including missing attendance rows;
- strict schema and canonical signature tests;
- secure discovery/fetch SSRF defenses and response limits;
- well-known/index/document routes with disable/revocation behavior;
- organizer UI showing every disclosed field before enabling;
- comparison UI with trust/suppression/version labels;
- retention, DPIA/data-controller, and incident/key-rotation documentation;
- updated spec 09, OpenAPI only if applicable, and threat-model tests; and
- no exposure to assistant tools or automated decisions.

## Open decisions

1. Reporting timezone and immutable period cut-off.
2. Stable expected-attendee population for attendance rate.
3. Exact versus bucketed/omitted cohort sizes.
4. Whether `sessions_held` itself is suppressed.
5. Recall metric cut-off after the 21-day answer window.
6. Correction/replacement and cache-retention semantics.
7. Key rotation and historical-key publication.
8. Pairwise configured peer UI versus any community directory.
9. Minimum number of organizations before any “network” view exists.
10. Whether the clinical/governance value justifies the re-identification and
    competitive-ranking risk at all.
