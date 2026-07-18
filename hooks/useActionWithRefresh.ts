'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Runs a server-action mutation and the follow-up router.refresh() inside
 * ONE React transition, so `isPending` stays true until the refreshed
 * server data has actually rendered — not just until the action returns.
 * That gap (action done, refresh still in flight) is exactly when buttons
 * used to re-enable while the screen still showed stale data.
 *
 * The nested startTransition around router.refresh() is deliberate: in
 * React 19, state updates after an `await` must be re-wrapped to remain
 * part of the same transition.
 *
 * Call sites keep their own try/catch + toasts inside `fn`; a thrown error
 * simply ends the transition (no refresh).
 */
export function useActionWithRefresh() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [key, setKey] = useState<string | null>(null)

  function run(fn: () => Promise<void>, actionKey = 'default') {
    setKey(actionKey)
    startTransition(async () => {
      try {
        await fn()
      } catch {
        // fn owns its error UX; skipping the refresh is the only job here.
        return
      }
      startTransition(() => {
        router.refresh()
      })
    })
  }

  return { isPending, pendingKey: isPending ? key : null, run }
}
