'use client'

import { useState } from 'react'
import { Button } from './Button'
import { releaseTeacherFeedback } from '@/app/actions/feedback'
import type { TeacherInvitation } from '@/lib/types'

interface ReleaseTeacherFeedbackPanelProps {
  sessionId: string
  invitations: TeacherInvitation[]
  registeredTeacherCount: number
}

export function ReleaseTeacherFeedbackPanel({
  sessionId,
  invitations,
  registeredTeacherCount,
}: ReleaseTeacherFeedbackPanelProps) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{
    sentCount: number
    totalTeachers: number
    failedCount: number
    privacySuppressed: boolean
    alreadyReleased: boolean
    inProgressCount: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const acceptedInvitations = invitations.filter(i => i.status === 'ACCEPTED')
  const totalTeachers = acceptedInvitations.length + registeredTeacherCount

  async function handleRelease() {
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await releaseTeacherFeedback(sessionId)
      setResult(res)
    } catch (err: any) {
      setError(err.message || 'Failed to release feedback')
    } finally {
      setLoading(false)
    }
  }

  if (totalTeachers === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">
        No accepted teachers for this session. Invite and confirm teachers first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Send each accepted teacher a privacy-safe aggregate report. Respondent
        names, email addresses, raw comments, attendance changes, and certificates
        are never included in this action. Detailed analytics are withheld when
        fewer than five people responded.
      </p>

      <div className="font-mono text-sm">
        <p>
          <strong>{totalTeachers}</strong> teacher{totalTeachers !== 1 ? 's' : ''} will receive the email:
        </p>
        <ul className="mt-2 space-y-1 pl-4">
          {acceptedInvitations.map(inv => (
            <li key={inv.id} className="text-gray-700">
              {inv.first_name} {inv.last_name} ({inv.email})
            </li>
          ))}
          {registeredTeacherCount > 0 && (
            <li className="text-gray-700">
              + {registeredTeacherCount} registered teacher{registeredTeacherCount !== 1 ? 's' : ''}
            </li>
          )}
        </ul>
      </div>

      {result && (
        <div className="border border-black bg-green-50 p-3 font-mono text-sm">
          {result.alreadyReleased
            ? '✓ The current feedback set was already released; no duplicate email was sent.'
            : `✓ Feedback report sent to ${result.sentCount} of ${result.totalTeachers} teacher${result.totalTeachers !== 1 ? 's' : ''}.`}
          {result.failedCount > 0 ? ` ${result.failedCount} delivery attempt${result.failedCount === 1 ? '' : 's'} failed.` : ''}
          {result.inProgressCount > 0 ? ` ${result.inProgressCount} delivery attempt${result.inProgressCount === 1 ? ' is' : 's are'} already in progress.` : ''}
        </div>
      )}

      {error && (
        <div className="border border-red-600 bg-red-50 p-3 font-mono text-sm text-red-700">
          {error}
        </div>
      )}

      <Button
        onClick={handleRelease}
        disabled={loading || !!result}
      >
        {loading
          ? 'Sending...'
          : result
            ? 'Sent ✓'
            : `Release Feedback to ${totalTeachers} Teacher${totalTeachers !== 1 ? 's' : ''}`
        }
      </Button>
    </div>
  )
}
