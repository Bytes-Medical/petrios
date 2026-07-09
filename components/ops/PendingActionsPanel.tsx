'use client'

import { useState } from 'react'
import { useOpsReview } from '@/hooks/useOpsReview'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { formatDateTimeShort } from '@/lib/ops/format'
import { OPS_ACTION_TYPE_LABELS, type OpsPendingAction } from '@/lib/types'

interface PendingActionsPanelProps {
  pending: OpsPendingAction[]
  reviewed: OpsPendingAction[]
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  executed: 'success',
  approved: 'warning',
  rejected: 'default',
  failed: 'danger',
}

export function PendingActionsPanel({ pending, reviewed }: PendingActionsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { busyId, error, review } = useOpsReview()

  return (
    <Card>
      <h2 className="mb-1 font-mono text-xl font-bold">Approval queue</h2>
      <p className="mb-4 font-mono text-sm text-gray-600">
        Emails and newsletters the assistant has drafted. Nothing is sent until
        you approve it here.
      </p>

      {error && (
        <p className="mb-4 border border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          {error}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
          Nothing waiting for review.
        </p>
      ) : (
        <div className="space-y-3">
          {pending.map((action) => {
            const expanded = expandedId === action.id
            return (
              <div key={action.id} className="border border-black">
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{OPS_ACTION_TYPE_LABELS[action.type]}</Badge>
                      <span className="font-mono text-xs text-gray-500">
                        {formatDateTimeShort(action.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-sm font-bold">{action.preview_title}</p>
                    <p
                      className={
                        expanded
                          ? 'mt-1 whitespace-pre-wrap font-mono text-xs text-gray-700'
                          : 'mt-1 line-clamp-2 font-mono text-xs text-gray-600'
                      }
                    >
                      {action.preview_body}
                    </p>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : action.id)}
                      className="mt-1 font-mono text-xs underline underline-offset-2 hover:text-clay-700"
                    >
                      {expanded ? 'Collapse' : 'Show full preview'}
                    </button>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === action.id}
                      onClick={() => review(action.id, 'approve')}
                    >
                      {busyId === action.id ? 'Working…' : 'Approve & send'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === action.id}
                      onClick={() => review(action.id, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-gray-500">
            Recently reviewed
          </h3>
          <div className="divide-y divide-gray-200 border border-gray-200">
            {reviewed.map((action) => (
              <div key={action.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs">{action.preview_title}</p>
                  {action.error && (
                    <p className="truncate font-mono text-[10px] text-red-700">{action.error}</p>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[action.status] ?? 'default'}>
                  {action.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
