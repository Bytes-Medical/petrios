import type { FeedbackAction } from '@/lib/db/feedback-actions'

/**
 * Public, read-only "You said, we did" list — closes the feedback loop on
 * the public feedback pages. Renders moderator-authored text only; never
 * any author or attendee identity.
 */
export function YouSaidWeDidList({ actions }: { actions: FeedbackAction[] }) {
  if (actions.length === 0) return null

  return (
    <div className="space-y-4">
      {actions.map((entry) => (
        <div key={entry.id} className="border border-gray-300 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-gray-500">
            You said
          </p>
          <p className="mt-1 font-mono text-sm leading-6">{entry.theme}</p>
          <div className="mt-3 border-l-2 border-clay-600 pl-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-gray-500">
              We did
            </p>
            <p className="mt-1 font-mono text-sm leading-6">{entry.action}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
