import type { SessionActivityEvent } from '@/lib/db/attendance'

export function SessionActivityPanel({ events }: { events: SessionActivityEvent[] }) {
  if (events.length === 0) return <p className="font-mono text-sm text-gray-600">No governed session events recorded yet.</p>
  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <li key={event.id} className="border border-gray-300 p-3">
          <p className="font-mono text-sm font-bold">{event.event_type.replaceAll('_', ' ')}</p>
          <p className="mt-1 font-mono text-xs text-gray-600">
            {new Date(event.created_at).toLocaleString('en-GB')} · actor {event.actor_user_id ?? 'system'}
          </p>
          {(event.subject_user_id || event.subject_external_email) && (
            <p className="mt-1 font-mono text-xs text-gray-600">Subject: {event.subject_user_id ?? event.subject_external_email}</p>
          )}
        </li>
      ))}
    </ol>
  )
}
