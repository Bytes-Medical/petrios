'use client'

import { markAttendance } from '@/app/actions/attendance'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import type { Attendance, AttendanceStatus } from '@/lib/types'

interface AttendanceListProps {
  sessionId: string
  attendance: Attendance[]
  teachers: any[]
  readOnly?: boolean
}

export function AttendanceList({ sessionId, attendance, teachers, readOnly = false }: AttendanceListProps) {
  const { pendingKey: updating, run } = useActionWithRefresh()

  function handleMarkAttendance(userId: string, status: AttendanceStatus) {
    const reason = window.prompt('Reason for this attendance decision:')?.trim()
    if (!reason) return
    run(async () => {
      try {
        await markAttendance(sessionId, userId, status, reason)
      } catch (error) {
        console.error('Failed to mark attendance:', error)
        throw error
      }
    }, userId)
  }

  if (attendance.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No attendance records yet.</p>
  }

  return (
    <div className="space-y-2">
      {attendance.map(record => (
        <div
          key={record.id}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border border-gray-300"
        >
          <div className="flex-1 min-w-0">
            <p className="font-mono text-sm break-words">
              <strong>User:</strong> {record.user_id}
            </p>
            <p className="font-mono text-sm text-gray-600">
              Status: {record.status}
              {record.primary_source && <> | Source: {record.primary_source}</>}
            </p>
            {record.first_evidence_at && (
              <p className="font-mono text-xs text-gray-500">
                First evidence: {new Date(record.first_evidence_at).toLocaleString('en-GB')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            {record.user_id && !readOnly && (
              <>
                <button
                  onClick={() => handleMarkAttendance(record.user_id!, 'PRESENT')}
                  disabled={updating === record.user_id}
                  className="px-3 py-1 border border-black bg-white text-black font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  Present
                </button>
                <button
                  onClick={() => handleMarkAttendance(record.user_id!, 'ABSENT')}
                  disabled={updating === record.user_id}
                  className="px-3 py-1 border border-black bg-white text-black font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  Absent
                </button>
                <button
                  onClick={() => handleMarkAttendance(record.user_id!, 'LATE')}
                  disabled={updating === record.user_id}
                  className="px-3 py-1 border border-black bg-white text-black font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  Late
                </button>
                <button
                  onClick={() => handleMarkAttendance(record.user_id!, 'EXCUSED')}
                  disabled={updating === record.user_id}
                  className="px-3 py-1 border border-black bg-white text-black font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
                >
                  Excused
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
