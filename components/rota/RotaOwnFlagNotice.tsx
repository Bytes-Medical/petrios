'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { contestMyRotaFlag } from '@/app/actions/rota-attendance'
import type { OwnRotaFlagView } from '@/lib/rota/types'

/**
 * A trainee's own rota note on their session page (spec/14). Only the
 * signed-in trainee ever sees it. It never names a reason or leave type. The
 * text follows the flag's state, and "This is wrong" (final, so it asks for
 * confirmation first) hides the suggestion from the moderator, who then
 * decides manually.
 */
function message(flag: OwnRotaFlagView): string {
  switch (flag.state) {
    case 'CONFIRMED':
      return 'Your moderator recorded you as excused (rostered unavailable) for this session.'
    case 'DISMISSED':
      return 'Your department’s rota showed you as unavailable for this session. Your moderator did not use the rota for this session.'
    case 'CONTESTED':
      return 'You told us the rota was wrong. Your moderator will decide manually.'
    default:
      return flag.beforeSession
        ? 'Your department’s rota shows you as unavailable for this session. If you can attend, please do. After the session your moderator decides how the rota is used.'
        : 'Your department’s rota showed you as unavailable for this session. Your moderator decides how this is used.'
  }
}

export function RotaOwnFlagNotice({ flag }: { flag: OwnRotaFlagView }) {
  const { isPending, run } = useActionWithRefresh()
  const [error, setError] = useState<string | null>(null)

  function contest() {
    if (
      !window.confirm(
        'Tell your moderator the rota is wrong for this session? This cannot be undone. The rota will then not be used for you: your moderator decides your attendance without it, and with no check-in or decision you are recorded as absent. If you could not attend because of your rota, do not use this.'
      )
    ) {
      return
    }
    setError(null)
    run(async () => {
      const result = await contestMyRotaFlag(flag.sessionId)
      if (!result.ok) setError(result.message)
    }, 'contest')
  }

  const kind = flag.kind === 'WORKED' ? 'as worked' : 'planned'

  return (
    <section
      aria-label="Rota availability"
      className="mb-6 space-y-3 border border-black bg-gray-50 px-4 py-3 font-mono text-sm"
    >
      <p>{message(flag)}</p>
      <p className="text-xs text-gray-600">
        Rota as of {flag.asOfLabel} ({kind}).
      </p>
      {flag.canContest && (
        <Button size="sm" variant="secondary" onClick={contest} pending={isPending}>
          This is wrong
        </Button>
      )}
      {error && (
        <p role="alert" className="border border-red-500 bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}
      <p className="text-xs text-gray-600">
        Missed teaching can still be exception-reported to your educational supervisor.
      </p>
    </section>
  )
}
