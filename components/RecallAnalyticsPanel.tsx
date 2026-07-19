'use client'

import { useEffect, useState } from 'react'
import { Card } from './Card'
import { getRecallAnalytics } from '@/app/actions/recall'
import {
  RETENTION_MIN_COHORT,
  type RetentionAnalytics,
  type RetentionKindStats,
} from '@/lib/recall-analytics'

/**
 * Catch-up analytics for moderators: final outcomes by days since the session.
 * Everything shown here is aggregate-only — cohorts under
 * RETENTION_MIN_COHORT arrive already suppressed from the server.
 */
export function RecallAnalyticsPanel({ sessionId }: { sessionId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<RetentionAnalytics | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getRecallAnalytics(sessionId)
        if (!cancelled) setAnalytics(data)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load analytics')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (loading) {
    return <p className="font-mono text-sm">Loading catch-up analytics...</p>
  }

  if (error) {
    return (
      <div className="border border-red-500 bg-red-50 p-4">
        <p className="font-mono text-sm text-red-800">{error}</p>
      </div>
    )
  }

  if (!analytics || analytics.totalResponses === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">
        No completed or exhausted catch-up outcomes yet. Individual attempts
        are never shown here.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="mb-1 font-mono text-sm text-gray-600">Responses</p>
          <p className="font-mono text-3xl font-bold">{analytics.totalResponses}</p>
          <p className="mt-1 font-mono text-xs text-gray-600">final outcomes only</p>
        </Card>
        <Card>
          <p className="mb-1 font-mono text-sm text-gray-600">Average final score</p>
          <HeadlineStat stats={analytics.catchUp} unit="%" field="avgScorePct" />
        </Card>
        <Card>
          <p className="mb-1 font-mono text-sm text-gray-600">5/5 completion rate</p>
          <HeadlineStat stats={analytics.catchUp} unit="%" field="passRatePct" />
        </Card>
      </div>

      <Card>
        <h3 className="mb-1 font-mono font-bold">Catch-up outcomes over time</h3>
        <p className="mb-4 font-mono text-xs text-gray-600">
          Average final score by days since the original session. Failed first
          or second attempts are not included.
        </p>
        <div className="space-y-4">
          {analytics.buckets.map((bucket) => (
            <div key={bucket.label}>
              <p className="mb-1 font-mono text-xs uppercase tracking-[0.18em] text-gray-500">
                {bucket.label}
              </p>
              <BucketBar stats={bucket.catchUp} barClass="bg-clay-600" />
            </div>
          ))}
        </div>
        <p className="mt-4 font-mono text-xs text-gray-500">
          Aggregates only — cohorts under {RETENTION_MIN_COHORT} are never shown.
        </p>
      </Card>
      {analytics.retention.n > 0 && (
        <Card>
          <h3 className="font-mono font-bold">Legacy attendee retention</h3>
          <p className="mt-1 font-mono text-xs text-gray-600">
            {analytics.retention.n} response{analytics.retention.n === 1 ? '' : 's'} from the
            pre-catch-up Recall workflow are retained for historical reporting.
          </p>
        </Card>
      )}
    </div>
  )
}

function HeadlineStat({
  stats,
  unit,
  field,
}: {
  stats: RetentionKindStats
  unit: string
  field: 'avgScorePct' | 'passRatePct'
}) {
  if (stats.suppressed) {
    return (
      <p className="font-mono text-sm text-gray-500">
        hidden — fewer than {RETENTION_MIN_COHORT} responses
      </p>
    )
  }
  return (
    <p className="font-mono text-3xl font-bold">
      {stats[field]}
      {unit}
    </p>
  )
}

function BucketBar({
  stats,
  barClass,
}: {
  stats: RetentionKindStats
  barClass: string
}) {
  return (
    <div className="mb-1 flex items-center gap-3">
      <div className="relative h-5 flex-1 bg-gray-200">
        {stats.suppressed ? (
          stats.n > 0 ? (
            <p className="absolute inset-0 flex items-center pl-2 font-mono text-xs text-gray-500">
              fewer than {RETENTION_MIN_COHORT} responses
            </p>
          ) : null
        ) : (
          <div className={`h-full ${barClass}`} style={{ width: `${stats.avgScorePct}%` }} />
        )}
      </div>
      <span className="w-24 text-right font-mono text-xs">
        {stats.suppressed ? `n=${stats.n}` : `${stats.avgScorePct}% · n=${stats.n}`}
      </span>
    </div>
  )
}
