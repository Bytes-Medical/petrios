'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useDismissable } from '@/hooks/useDismissable'
import { useOpsReview } from '@/hooks/useOpsReview'
import { OPS_ACTION_TYPE_LABELS, type OpsPendingAction } from '@/lib/types'

interface ApprovalsBellProps {
  actions: OpsPendingAction[]
  count: number
}

/**
 * The Bytes Ops approval queue in the nav — the "upgraded notifications"
 * panel. Nothing the agent drafts goes out until it is approved here (or on
 * the full /ops queue, which shows the complete preview body).
 */
export function ApprovalsBell({ actions, count }: ApprovalsBellProps) {
  const [open, setOpen] = useState(false)
  const { busyId, error, review } = useOpsReview()
  const containerRef = useRef<HTMLDivElement>(null)

  useDismissable(containerRef, open, () => setOpen(false))

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Approvals (${count} pending)` : 'Approvals'}
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center border border-black bg-white hover:bg-gray-50"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        >
          <rect x="5" y="4" width="14" height="17" />
          <path d="M9 4V2h6v2" />
          <path d="M9 13l2 2 4-4" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center bg-clay-600 px-1 font-mono text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-96 max-w-[90vw] border border-black bg-white shadow-[4px_4px_0_0_#1F1D1A]">
          <div className="flex items-center justify-between border-b border-black px-3 py-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider">
              Pending approvals
            </span>
            <Link
              href="/ops"
              onClick={() => setOpen(false)}
              className="font-mono text-xs underline underline-offset-2 hover:text-clay-700"
            >
              Open Ops →
            </Link>
          </div>
          {error && (
            <p className="border-b border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
              {error}
            </p>
          )}
          <div className="max-h-96 overflow-y-auto">
            {actions.length === 0 ? (
              <p className="px-3 py-6 text-center font-mono text-xs text-gray-500">
                Nothing waiting — the assistant will queue drafted emails and
                newsletters here for your sign-off.
              </p>
            ) : (
              actions.map((action) => (
                <div
                  key={action.id}
                  className="border-b border-gray-200 px-3 py-2.5 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold">{action.preview_title}</span>
                    <span className="shrink-0 border border-black bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                      {OPS_ACTION_TYPE_LABELS[action.type]}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 font-mono text-xs text-gray-600">
                    {action.preview_body}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === action.id}
                      onClick={() => review(action.id, 'approve')}
                      className="border border-clay-600 bg-clay-600 px-2.5 py-1 font-mono text-xs font-bold text-white hover:bg-clay-700 disabled:opacity-50"
                    >
                      {busyId === action.id ? 'Working…' : 'Approve & send'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === action.id}
                      onClick={() => review(action.id, 'reject')}
                      className="border border-black bg-white px-2.5 py-1 font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
