'use client'

import { markAttendance, markExternalAttendance } from '@/app/actions/attendance'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import type { Attendance, AttendanceStatus } from '@/lib/types'

interface AttendanceListProps {
  sessionId: string
  attendance: Attendance[]
  teachers: any[]
  readOnly?: boolean
  externalTeachers?: { email: string; name: string }[]
}

export function AttendanceList({
  sessionId,
  attendance,
  teachers,
  readOnly = false,
  externalTeachers = [],
}: AttendanceListProps) {
  const { pendingKey: updating, run } = useActionWithRefresh()
  void teachers

  function handleMarkAttendance(
    subject: { userId: string } | { externalEmail: string },
    status: AttendanceStatus
  ) {
    const reason = window.prompt('Reason for this attendance decision:')?.trim()
    if (!reason) return
    const key = 'userId' in subject ? subject.userId : subject.externalEmail
    run(async () => {
      try {
        if ('userId' in subject) {
          await markAttendance(sessionId, subject.userId, status, reason)
        } else {
          await markExternalAttendance(sessionId, subject.externalEmail, status, reason)
        }
      } catch (error) {
        console.error('Failed to mark attendance:', error)
        throw error
      }
    }, key)
  }

  const recordedExternalEmails = new Set(
    attendance
      .map((record) => record.external_email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email))
  )
  const unrecordedExternalTeachers = externalTeachers.filter(
    (teacher) => !recordedExternalEmails.has(teacher.email.trim().toLowerCase())
  )

  function attendanceButtons(subject: { userId: string } | { externalEmail: string }) {
    if (readOnly) return null
    const key = 'userId' in subject ? subject.userId : subject.externalEmail
    return (
      <div className="flex flex-wrap gap-2 w-full sm:w-auto">
        {(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as AttendanceStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => handleMarkAttendance(subject, status)}
            disabled={updating === key}
            className="px-3 py-1 border border-black bg-white text-black font-mono text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
    )
  }

  if (attendance.length === 0 && unrecordedExternalTeachers.length === 0) {
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
              <strong>{record.user_id ? 'User' : 'External teacher'}:</strong>{' '}
              {record.user_id ?? record.external_email}
            </p>
            <p className="font-mono text-sm text-gray-600">
              Status: {record.status}
              {record.primary_source && (
                <> | Source: {record.primary_source === 'RECALL' ? 'Audio recap catch-up' : record.primary_source}</>
              )}
            </p>
            {record.first_evidence_at && (
              <p className="font-mono text-xs text-gray-500">
                First evidence: {new Date(record.first_evidence_at).toLocaleString('en-GB')}
              </p>
            )}
          </div>
          {record.user_id
            ? attendanceButtons({ userId: record.user_id })
            : record.external_email
              ? attendanceButtons({ externalEmail: record.external_email })
              : null}
        </div>
      ))}
      {unrecordedExternalTeachers.map((teacher) => (
        <div
          key={teacher.email}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 border border-gray-300"
        >
          <div className="flex-1 min-w-0">
            <p className="font-mono text-sm break-words">
              <strong>External teacher:</strong> {teacher.name} ({teacher.email})
            </p>
            <p className="font-mono text-sm text-gray-600">Status: Not recorded</p>
          </div>
          {attendanceButtons({ externalEmail: teacher.email })}
        </div>
      ))}
    </div>
  )
}
