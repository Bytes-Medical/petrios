'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateGroupCode, lockAttendance, unlockAttendance } from '@/app/actions/attendance-evidence'
import type { Attendance, Session } from '@/lib/types'
import type { TeacherInvitation } from '@/lib/types'
import type { AttendanceEvidence, SessionParticipant } from '@/lib/db/attendance'
import { AttendanceList } from './AttendanceList'
import { Button } from './Button'

export function SessionAttendanceManagementPanel({
  session,
  attendance,
  participants,
  evidence,
  invitations,
}: {
  session: Session
  attendance: Attendance[]
  participants: SessionParticipant[]
  evidence: AttendanceEvidence[]
  invitations: TeacherInvitation[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeCode, setActiveCode] = useState<{
    code: string
    version: number
    expiresAt: string | null
  } | null>(null)
  const finalized = session.attendance_phase === 'FINALIZED'
  const counts = {
    present: attendance.filter((row) => row.status === 'PRESENT').length,
    late: attendance.filter((row) => row.status === 'LATE').length,
    absent: attendance.filter((row) => row.status === 'ABSENT').length,
    excused: attendance.filter((row) => row.status === 'EXCUSED').length,
  }

  async function finalize() {
    if (!window.confirm('Finalize this attendance roster? Certificate eligibility will use this revision.')) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await lockAttendance(session.id)
      setNotice(
        result.notificationFailures > 0
          ? `Attendance revision ${result.revision} was finalized. ${result.notificationFailures} in-app notification(s) could not be created; finalization itself is safe.`
          : `Attendance revision ${result.revision} was finalized and participants were notified.`
      )
      router.refresh()
    } catch (finalizeError) {
      setError(finalizeError instanceof Error ? finalizeError.message : 'Finalization failed')
    } finally {
      setBusy(false)
    }
  }

  async function reopen() {
    const reason = window.prompt('Why is finalized attendance being reopened?')?.trim()
    if (!reason) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await unlockAttendance(session.id, reason)
      setNotice(
        result.notificationFailures > 0
          ? `Attendance was reopened. ${result.notificationFailures} participant notification(s) could not be created.`
          : 'Attendance was reopened and participants were notified.'
      )
      router.refresh()
    } catch (reopenError) {
      setError(reopenError instanceof Error ? reopenError.message : 'Reopening failed')
    } finally {
      setBusy(false)
    }
  }

  async function rotateGroupCode() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await generateGroupCode(session.id)
      setActiveCode(result)
      setNotice('A new code is active. It is shown only in this browser state; copy or announce it now.')
      router.refresh()
    } catch (codeError) {
      setError(codeError instanceof Error ? codeError.message : 'Code generation failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border border-black p-4">
        <div>
          <p className="font-mono text-sm font-bold">Lifecycle: {session.attendance_phase ?? (session.attendance_locked ? 'FINALIZED' : 'OPEN')}</p>
          <p className="mt-1 font-mono text-xs text-gray-600">
            Policy v{session.attendance_policy_version ?? 1} · revision {session.attendance_revision ?? 0} · {participants.length} rostered participant{participants.length === 1 ? '' : 's'}
          </p>
        </div>
        {finalized ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={reopen}>Reopen with reason</Button>
        ) : (
          <Button type="button" disabled={busy || new Date(session.date_end) > new Date()} onClick={finalize}>Finalize attendance</Button>
        )}
        <a href={`/api/sessions/${session.id}/attendance/export`} className="border border-black px-3 py-2 font-mono text-sm hover:bg-gray-50">
          Export CSV
        </a>
      </div>

      {error && <p className="border border-red-700 bg-red-50 p-3 font-mono text-sm text-red-700">{error}</p>}
      {notice && <p className="border border-blue-700 bg-blue-50 p-3 font-mono text-sm text-blue-900">{notice}</p>}

      {!finalized && session.status === 'PUBLISHED' ? (
        <div className="border border-gray-300 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-sm font-bold">Session group code</p>
              <p className="mt-1 font-mono text-xs text-gray-600">
                Generating a new code invalidates the previous one and requires participants to enter it instead of plain self check-in.
              </p>
            </div>
            <Button type="button" variant="secondary" disabled={busy} onClick={rotateGroupCode}>
              Generate new code
            </Button>
          </div>
          {activeCode ? (
            <div className="mt-3 border border-black bg-gray-50 p-3">
              <p className="font-mono text-3xl font-bold tracking-[0.25em]">{activeCode.code}</p>
              <p className="mt-1 font-mono text-xs text-gray-600">
                Version {activeCode.version} · expires {activeCode.expiresAt ? new Date(activeCode.expiresAt).toLocaleString('en-GB') : 'at the configured boundary'}
              </p>
              <button
                type="button"
                className="mt-2 font-mono text-xs underline"
                onClick={() => navigator.clipboard?.writeText(activeCode.code)}
              >
                Copy code
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Present', counts.present],
          ['Late', counts.late],
          ['Absent', counts.absent],
          ['Excused', counts.excused],
          ['Evidence', evidence.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="border border-gray-300 p-3">
            <p className="font-mono text-xs text-gray-600">{label}</p>
            <p className="font-mono text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {!finalized && (
        <p className="border border-amber-600 bg-amber-50 p-3 font-mono text-xs text-amber-900">
          Missing evidence is “not recorded” until finalization. Finalization snapshots current department members and accepted teachers, then creates explicit absent/excused results.
        </p>
      )}

      <div>
        <h3 className="mb-2 font-mono text-sm font-bold">Computed results</h3>
        <AttendanceList
          sessionId={session.id}
          attendance={attendance}
          teachers={[]}
          readOnly={finalized}
          externalTeachers={invitations
            .filter((invitation) => invitation.status === 'ACCEPTED')
            .map((invitation) => ({
              email: invitation.email.trim().toLowerCase(),
              name:
                [invitation.first_name, invitation.last_name].filter(Boolean).join(' ').trim()
                || invitation.email,
            }))}
        />
      </div>

      <div>
        <h3 className="mb-2 font-mono text-sm font-bold">Evidence trail</h3>
        {evidence.length === 0 ? (
          <p className="font-mono text-sm text-gray-600">No attendance evidence recorded.</p>
        ) : (
          <ul className="space-y-2">
            {evidence.map((item) => (
              <li key={item.id} className="border border-gray-300 p-3 font-mono text-xs">
                <span className="font-bold">{item.source}</span> · {item.user_id ?? item.external_email} · {new Date(item.observed_at).toLocaleString('en-GB')}
                {item.correction_reason ? <span className="mt-1 block text-gray-700">Reason: {item.correction_reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
