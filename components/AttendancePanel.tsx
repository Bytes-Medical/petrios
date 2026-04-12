import { AttendanceRing } from '@/components/AttendanceRing'
import type { AttendanceSummary } from '@/lib/db/trainee-dashboard'

interface AttendancePanelProps {
  summary: AttendanceSummary
}

const STATUS_BADGE: Record<string, string> = {
  PRESENT: 'bg-green-100 text-green-800',
  LATE: 'bg-yellow-100 text-yellow-800',
  ABSENT: 'bg-red-100 text-red-800',
}

const SOURCE_LABELS: Record<string, string> = {
  SELF_CHECKIN: 'Self',
  GROUP_CODE: 'Code',
  FEEDBACK: 'Feedback',
  TEACHER: 'Teacher',
  TEAMS: 'Teams',
}

export function AttendancePanel({ summary }: AttendancePanelProps) {
  return (
    <div className="space-y-6">
      {/* Ring + stats */}
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
        <AttendanceRing percentage={summary.attendance_pct} />
        <div className="flex flex-col gap-3 text-center sm:text-left">
          <div>
            <p className="font-mono text-2xl font-bold">
              {summary.attended} / {summary.total_sessions}
            </p>
            <p className="font-mono text-xs text-gray-500 uppercase">Sessions Attended</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-bold">{summary.current_streak}</p>
            <p className="font-mono text-xs text-gray-500 uppercase">Current Streak</p>
          </div>
        </div>
      </div>

      {/* Per-session log */}
      {summary.sessions.length === 0 ? (
        <p className="font-mono text-sm text-gray-400">No sessions to show yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse font-mono text-sm">
            <thead>
              <tr className="border-b-2 border-black text-left">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Session</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {summary.sessions.map((s) => {
                const date = new Date(s.session_date).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                })
                return (
                  <tr key={s.session_id} className="border-b border-gray-200">
                    <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{date}</td>
                    <td className="py-2 pr-4 max-w-[200px] truncate">{s.session_title}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs ${STATUS_BADGE[s.status] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-500 text-xs">
                      {s.primary_source ? SOURCE_LABELS[s.primary_source] || s.primary_source : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
