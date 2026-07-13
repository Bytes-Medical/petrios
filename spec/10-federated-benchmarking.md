# 10 — Federated benchmarking (petrios-benchmark/v1)

**Status: RFC — specified, not implemented.** This document defines the
protocol so it can gather feedback (GitHub RFC issue) before any code
ships. Nothing in the codebase serves or consumes benchmark documents yet.

## Motivation

Every Petrios instance is an island by design — trusts self-host and no
data leaves their servers. The cost is context: a department with 71%
attendance has no idea whether that is normal, good, or a warning sign.
Federated benchmarking lets instances *opt in* to publishing signed,
aggregate-only monthly metrics that other instances can fetch, verify,
and render as "you vs. the network" — with nothing identifiable ever
leaving anyone's servers.

## Document shape

A benchmark document is JSON, signed the same way as teaching records
(`lib/federation.ts`): Ed25519 over the canonical JSON (sorted keys, no
whitespace — `canonicalize`) of the document minus its `signature` field.

```json
{
  "format": "petrios-benchmark/v1",
  "instance": "https://teaching.example.nhs.uk",
  "public_key": "<SPKI DER base64 — same key as /.well-known/petrios>",
  "period": "2026-06",
  "generated_at": "2026-07-01T00:00:00Z",
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
  "signature": "<Ed25519 base64>"
}
```

- `period` is a calendar month (`YYYY-MM`), the **granularity floor** (see
  privacy invariants).
- A metric the instance chose not to share is **omitted** — indistinguishable
  from "not measured". A metric withheld *for privacy* (cohort under the
  suppression threshold) is omitted **and** named in `suppressed`, so a
  small-but-honest instance doesn't read as opaque.
- `cohorts` carries the denominator sizes so consumers can weight
  comparisons. (Open RFC question: do cohort counts themselves leak too
  much for very small trusts?)

## Metric definitions (v1)

| Metric | Formula |
|---|---|
| `sessions_held` | count of PUBLISHED sessions with `date_end` in the period |
| `attendance_rate_pct` | (PRESENT + LATE attendance rows) ÷ expected attendees, across the period's sessions |
| `feedback_avg` | mean overall submission score, as computed by `getSessionFeedbackStats` |
| `recall_retention_median_pct` | median of per-session average retention-percent among the period's sessions that individually have recall n ≥ 5 |

## Suppression

The same rule as in-product retention analytics: any metric whose cohort
is smaller than **`RETENTION_MIN_COHORT` (5, `lib/recall-analytics.ts`)**
is suppressed. A future implementation must reuse that constant, not
duplicate it. The same k-anonymity caveat applies and is accepted: a
cohort of exactly 5 with identical values still implies the individual
values; threshold suppression bounds inference, it does not eliminate it.

## Privacy invariants (hard)

1. **Aggregates only.** Never per-person, per-grade, or per-department
   data. Org-level monthly is the floor — departments can be small enough
   to deanonymize.
2. **No join keys.** Nothing in a document may allow correlation back to
   an individual (no user ids, emails, session ids, or timestamps finer
   than the period).
3. **Opt-in per metric, default entirely off.** Publishing requires an
   explicit organiser decision per metric.
4. **Signatures are tamper-evidence, not confidentiality.** Documents are
   public by construction; publish nothing you would not put on a poster.
5. **Revocable.** Stop serving the URL and the data stops flowing;
   consumers must not treat historical fetches as authoritative.

## Discovery & transport

Pull-based, no central registry:

- `/.well-known/petrios` gains an optional `benchmark_url` field pointing
  at the current document (or a small index of recent periods).
- Consumers fetch over HTTPS, verify offline against the embedded
  `public_key`, and best-effort cross-check that key against the issuer's
  live `/.well-known/petrios` — the same three-outcome model as
  `/verify/record` (valid / valid-but-unverified-issuer / invalid).
- Aggregation across many instances (a community "network view") is left
  to v2; v1 is strictly pairwise fetch-and-compare.

## Open questions (for the RFC)

1. Is the v1 metric set right? (Candidates cut: certificates issued,
   slot-claim latency, feedback response rate.)
2. Monthly vs. quarterly floor for small programmes?
3. Do `cohorts` counts leak too much for very small trusts — should they
   be bucketed (`"attendance_n": "100-250"`)?
4. Discovery: is `benchmark_url` in the well-known document enough, or is
   a lightweight opt-in directory worth the centralization trade-off?
5. Key rotation interplay with the existing federation ROADMAP item
   (publish previous keys in the well-known doc?).
