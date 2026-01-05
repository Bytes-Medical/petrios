'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from './Button'
import { markAttendance } from '@/app/actions/attendance'
import { lockAttendance, unlockAttendance, getSessionEvidence } from '@/app/actions/attendance-evidence'
import type { AttendanceStatus } from '@/lib/types'

interface AttendanceTrackingPanelProps {
  sessionId: string
  attendance: any[]
  isLocked?: boolean
}

export function AttendanceTrackingPanel({ sessionId, attendance, isLocked = false }: AttendanceTrackingPanelProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showEvidence, setShowEvidence] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<Record<string, any[]>>({})

  async function handleMarkAttendance(userId: string, status: AttendanceStatus) {
    if (isLocked) {
      setError('Attendance is locked. Unlock to make changes.')
      return
    }

    setLoading(`${userId}-${status}`)
    setError(null)

    try {
      await markAttendance(sessionId, userId, status)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark attendance')
      setLoading(null)
    }
  }

  async function handleLock() {
    setLoading('lock')
    setError(null)
    try {
      await lockAttendance(sessionId)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to lock attendance')
      setLoading(null)
    }
  }

  async function handleUnlock() {
    setLoading('unlock')
    setError(null)
    try {
      await unlockAttendance(sessionId)
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock attendance')
      setLoading(null)
    }
  }

  async function handleShowEvidence(userId: string) {
    if (showEvidence === userId) {
      setShowEvidence(null)
      return
    }

    setLoading(`evidence-${userId}`)
    try {
      const allEvidence = await getSessionEvidence(sessionId)
      const userEvidence = allEvidence.filter(e => e.user_id === userId)
      setEvidence(prev => ({ ...prev, [userId]: userEvidence }))
      setShowEvidence(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence')
    } finally {
      setLoading(null)
    }
  }

  const presentCount = attendance.filter(a => a.status === 'PRESENT').length
  const lateCount = attendance.filter(a => a.status === 'LATE').length
  const absentCount = attendance.filter(a => a.status === 'ABSENT').length

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="p-3 border border-black">
          <p className="font-mono text-sm">Present: <strong>{presentCount}</strong></p>
        </div>
        <div className="p-3 border border-black">
          <p className="font-mono text-sm">Late: <strong>{lateCount}</strong></p>
        </div>
        <div className="p-3 border border-black">
          <p className="font-mono text-sm">Absent: <strong>{absentCount}</strong></p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href={`/api/sessions/${sessionId}/attendance/export`}
          className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50"
        >
          Export CSV
        </Link>
        {isLocked ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleUnlock}
            disabled={loading === 'unlock'}
          >
            {loading === 'unlock' ? 'Unlocking...' : 'Unlock Attendance'}
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={handleLock}
            disabled={loading === 'lock'}
          >
            {loading === 'lock' ? 'Locking...' : 'Lock Attendance'}
          </Button>
        )}
      </div>

      {isLocked && (
        <div className="mb-4 p-3 border border-yellow-500 bg-yellow-50">
          <p className="font-mono text-sm text-yellow-800">
            ⚠️ Attendance is locked. Changes require unlocking.
          </p>
        </div>
      )}

      <div>
        <h3 className="font-mono font-bold mb-2">Attendance List</h3>
        {attendance.length === 0 ? (
          <p className="font-mono text-sm text-gray-600">No attendance records yet.</p>
        ) : (
          <div className="space-y-2">
            {attendance.map(record => (
              <div key={record.id} className="space-y-2">
                <div className="flex items-center justify-between p-3 border border-gray-300">
                  <div className="flex-1">
                    <p className="font-mono text-sm font-bold">{record.user_id}</p>
                    <p className="font-mono text-xs text-gray-600">
                      Status: {record.status}
                      {record.primary_source && <> | Source: {record.primary_source}</>}
                      {record.first_evidence_at && (
                        <> | First evidence: {new Date(record.first_evidence_at).toLocaleString()}</>
                      )}
                      {record.locked && <> | 🔒 Locked</>}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleShowEvidence(record.user_id)}
                      disabled={loading === `evidence-${record.user_id}`}
                      className="text-xs"
                    >
                      {loading === `evidence-${record.user_id}` ? 'Loading...' : 'Evidence'}
                    </Button>
                    {!isLocked && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleMarkAttendance(record.user_id, 'PRESENT')}
                          disabled={loading === `${record.user_id}-PRESENT` || record.status === 'PRESENT'}
                          className="text-xs"
                        >
                          Present
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => handleMarkAttendance(record.user_id, 'LATE')}
                          disabled={loading === `${record.user_id}-LATE` || record.status === 'LATE'}
                          className="text-xs"
                        >
                          Late
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          onClick={() => handleMarkAttendance(record.user_id, 'ABSENT')}
                          disabled={loading === `${record.user_id}-ABSENT` || record.status === 'ABSENT'}
                          className="text-xs"
                        >
                          Absent
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {showEvidence === record.user_id && evidence[record.user_id] && (
                  <div className="ml-4 p-3 border border-gray-200 bg-gray-50">
                    <p className="font-mono text-xs font-bold mb-2">Evidence Trail:</p>
                    <div className="space-y-1">
                      {evidence[record.user_id].map((ev, idx) => (
                        <div key={ev.id || idx} className="font-mono text-xs">
                          <span className="font-bold">{ev.source}</span> at {new Date(ev.observed_at).toLocaleString()}
                          {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                            <span className="text-gray-600 ml-2">
                              ({JSON.stringify(ev.metadata)})
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
