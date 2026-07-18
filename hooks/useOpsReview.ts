'use client'

import { useState } from 'react'
import { approveOpsAction, rejectOpsAction } from '@/app/actions/ops'
import { useActionWithRefresh } from './useActionWithRefresh'

/**
 * Shared approve/reject handler for the ops approval surfaces (nav bell and
 * the /ops queue): tracks which action is busy, surfaces the server error,
 * and refreshes the route on success. Built on useActionWithRefresh so the
 * busy state covers the refresh re-render too, not just the action.
 */
export function useOpsReview() {
  const { pendingKey, run } = useActionWithRefresh()
  const [error, setError] = useState<string | null>(null)

  function review(id: string, decision: 'approve' | 'reject') {
    setError(null)
    run(async () => {
      try {
        if (decision === 'approve') {
          await approveOpsAction(id)
        } else {
          await rejectOpsAction(id)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
        throw err
      }
    }, id)
  }

  return { busyId: pendingKey, error, review }
}
