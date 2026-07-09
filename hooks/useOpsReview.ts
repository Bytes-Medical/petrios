'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { approveOpsAction, rejectOpsAction } from '@/app/actions/ops'

/**
 * Shared approve/reject handler for the ops approval surfaces (nav bell and
 * the /ops queue): tracks which action is busy, surfaces the server error,
 * and refreshes the route on success.
 */
export function useOpsReview() {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function review(id: string, decision: 'approve' | 'reject') {
    setBusyId(id)
    setError(null)
    try {
      if (decision === 'approve') {
        await approveOpsAction(id)
      } else {
        await rejectOpsAction(id)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusyId(null)
    }
  }

  return { busyId, error, review }
}
