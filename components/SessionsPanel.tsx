import Link from 'next/link'
import type { SessionType } from '@/lib/types'
import { SESSION_TYPE_LABELS, SESSION_TYPE_COLORS, SESSION_TYPE_BG_COLORS } from '@/lib/types'
import type { SessionWithDetails } from '@/lib/db/trainee-dashboard'

interface SessionsPanelProps {
  upcoming: SessionWithDetails[]
  past: SessionWithDetails[]
}

const LOCATION_LABELS: Record<string, string> = {
  MS_TEAMS: 'Online',
  IN_PERSON: 'In Person',
  HYBRID: 'Hybrid',
}

function SessionCard({ session }: { session: SessionWithDetails }) {
  const borderColor = session.session_type
    ? SESSION_TYPE_COLORS[session.session_type]
    : 'border-l-gray-400'

  const typeBadge = session.session_type
    ? SESSION_TYPE_BG_COLORS[session.session_type]
    : 'bg-gray-100 text-gray-700'

  const typeLabel = session.session_type
    ? SESSION_TYPE_LABELS[session.session_type]
    : 'General'

  const date = new Date(session.date_start)
  const endDate = new Date(session.date_end)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const timeStr = `${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} – ${endDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={`block border border-black border-l-4 ${borderColor} bg-white p-4 hover:bg-gray-50`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-mono text-sm font-bold">{session.title}</h3>
        <span className={`shrink-0 px-2 py-0.5 font-mono text-xs ${typeBadge}`}>
          {typeLabel}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-gray-600">
        {dateStr} &middot; {timeStr}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className="font-mono text-xs text-gray-500">
          {LOCATION_LABELS[session.location_type] || session.location_type}
        </span>
        {session.department_name && (
          <span className="font-mono text-xs text-gray-500">
            &middot; {session.department_name}
          </span>
        )}
      </div>
      {session.teacher_names.length > 0 && (
        <p className="mt-1 font-mono text-xs text-gray-500">
          Faculty: {session.teacher_names.join(', ')}
        </p>
      )}
      {session.my_attendance_status && (
        <span
          className={`mt-2 inline-block px-2 py-0.5 font-mono text-xs ${
            session.my_attendance_status === 'PRESENT'
              ? 'bg-green-100 text-green-800'
              : session.my_attendance_status === 'LATE'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-red-100 text-red-800'
          }`}
        >
          {session.my_attendance_status}
        </span>
      )}
    </Link>
  )
}

export function SessionsPanel({ upcoming, past }: SessionsPanelProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
          Upcoming ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="font-mono text-sm text-gray-400">No upcoming sessions</p>
        ) : (
          <div className="space-y-3">
            {upcoming.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
          Past ({past.length})
        </h3>
        {past.length === 0 ? (
          <p className="font-mono text-sm text-gray-400">No past sessions</p>
        ) : (
          <div className="space-y-3">
            {past.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
