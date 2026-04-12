import type { FeedbackHistoryEntry } from '@/lib/db/trainee-dashboard'

interface FeedbackPanelProps {
  entries: FeedbackHistoryEntry[]
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="font-mono text-sm" aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < rating ? 'text-black' : 'text-gray-300'}>
          ★
        </span>
      ))}
    </span>
  )
}

export function FeedbackPanel({ entries }: FeedbackPanelProps) {
  const totalCount = entries.length
  const avgRating =
    totalCount > 0
      ? entries.reduce((sum, e) => sum + (e.rating ?? 0), 0) / entries.filter((e) => e.rating).length
      : 0
  const latestDate =
    totalCount > 0
      ? new Date(entries[0].submitted_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—'

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border border-black bg-white p-4 text-center">
          <p className="font-mono text-2xl font-bold">{totalCount}</p>
          <p className="font-mono text-xs text-gray-500 uppercase">Submitted</p>
        </div>
        <div className="border border-black bg-white p-4 text-center">
          <p className="font-mono text-2xl font-bold">
            {avgRating > 0 ? avgRating.toFixed(1) : '—'}
          </p>
          <p className="font-mono text-xs text-gray-500 uppercase">Avg Rating</p>
        </div>
        <div className="border border-black bg-white p-4 text-center">
          <p className="font-mono text-sm font-bold">{latestDate}</p>
          <p className="font-mono text-xs text-gray-500 uppercase">Latest</p>
        </div>
      </div>

      {/* History list */}
      {totalCount === 0 ? (
        <p className="font-mono text-sm text-gray-400">No feedback submitted yet</p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => {
            const date = new Date(entry.session_date).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })

            return (
              <div key={entry.id} className="border border-black bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-mono text-sm font-bold">{entry.session_title}</h4>
                    <p className="font-mono text-xs text-gray-500">
                      {entry.department_name} &middot; {date}
                    </p>
                  </div>
                  {entry.rating && <StarRating rating={entry.rating} />}
                </div>
                {entry.comment && (
                  <p className="mt-2 font-mono text-xs text-gray-600 line-clamp-2">
                    {entry.comment}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
