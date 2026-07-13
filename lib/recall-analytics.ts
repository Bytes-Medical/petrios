/**
 * Pure aggregation for Petrios Recall retention analytics — did the teaching
 * stick? Consumes score rows WITHOUT user ids (see
 * lib/db/recall.ts#listAnswerStatsForSession) and returns aggregates only.
 *
 * Privacy core: any cohort smaller than RETENTION_MIN_COHORT has its
 * score-derived stats suppressed (nulled) before anything leaves the server.
 * Counts stay visible — counts alone reveal no scores. This threshold is
 * k-anonymity, not differential privacy: a full-marks cohort of exactly 5
 * still implies each member's score (documented in spec/08). Never lower it.
 */

/** Below this cohort size, score-derived stats are suppressed. Deliberately
 * the same value as SMALL_COHORT_THRESHOLD in lib/equity.ts. */
export const RETENTION_MIN_COHORT = 5

export type RecallKind = 'RETENTION' | 'CATCH_UP'

/** One answer's stats — deliberately no user_id. */
export interface RecallAnswerStat {
  kind: RecallKind
  score: number
  total: number
  passed: boolean
  answered_at: string
}

export interface RetentionKindStats {
  n: number
  /** Mean percent score (1dp); null when suppressed. */
  avgScorePct: number | null
  /** Whole-percent pass rate; null when suppressed. */
  passRatePct: number | null
  suppressed: boolean
}

export interface RetentionBucket {
  label: string
  minDay: number
  /** null = open-ended final bucket (late answers clamp here). */
  maxDay: number | null
  retention: RetentionKindStats
  catchUp: RetentionKindStats
}

export interface RetentionAnalytics {
  totalResponses: number
  retention: RetentionKindStats
  catchUp: RetentionKindStats
  /** RETENTION answers ÷ attendee count; null when attendee count unknown. */
  attendeeResponseRatePct: number | null
  buckets: RetentionBucket[]
}

/** Bucket edges follow the recall cadence: sent at end+3d, boosted at +14d,
 * window closes +21d. */
const BUCKET_DEFS = [
  { label: '0–3 days', minDay: 0, maxDay: 3 },
  { label: '4–7 days', minDay: 4, maxDay: 7 },
  { label: '8–14 days', minDay: 8, maxDay: 14 },
  { label: '15–21+ days', minDay: 15, maxDay: null },
] as const

/** Whole days between session end and the answer, clamped to >= 0. */
export function daysSinceSession(answeredAt: string, sessionDateEnd: string): number {
  const diffMs = new Date(answeredAt).getTime() - new Date(sessionDateEnd).getTime()
  return Math.max(0, Math.floor(diffMs / 86_400_000))
}

function statsFor(answers: RecallAnswerStat[]): RetentionKindStats {
  const n = answers.length
  if (n < RETENTION_MIN_COHORT) {
    return { n, avgScorePct: null, passRatePct: null, suppressed: true }
  }
  const pctSum = answers.reduce(
    (sum, a) => sum + (a.total > 0 ? (a.score / a.total) * 100 : 0),
    0
  )
  const passed = answers.filter((a) => a.passed).length
  return {
    n,
    avgScorePct: Math.round((pctSum / n) * 10) / 10,
    passRatePct: Math.round((passed / n) * 100),
    suppressed: false,
  }
}

export function computeRetentionAnalytics(
  answers: RecallAnswerStat[],
  sessionDateEnd: string,
  attendeeCount: number | null
): RetentionAnalytics {
  const retentionAnswers = answers.filter((a) => a.kind === 'RETENTION')
  const catchUpAnswers = answers.filter((a) => a.kind === 'CATCH_UP')

  const buckets: RetentionBucket[] = BUCKET_DEFS.map((def) => {
    const inBucket = (a: RecallAnswerStat) => {
      const day = daysSinceSession(a.answered_at, sessionDateEnd)
      return day >= def.minDay && (def.maxDay === null || day <= def.maxDay)
    }
    return {
      label: def.label,
      minDay: def.minDay,
      maxDay: def.maxDay,
      retention: statsFor(retentionAnswers.filter(inBucket)),
      catchUp: statsFor(catchUpAnswers.filter(inBucket)),
    }
  })

  return {
    totalResponses: answers.length,
    retention: statsFor(retentionAnswers),
    catchUp: statsFor(catchUpAnswers),
    attendeeResponseRatePct:
      attendeeCount && attendeeCount > 0
        ? Math.round((retentionAnswers.length / attendeeCount) * 100)
        : null,
    buckets,
  }
}
