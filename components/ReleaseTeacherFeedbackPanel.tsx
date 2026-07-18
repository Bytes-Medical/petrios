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
    failures: { email: string; message: string }[]
    providerReceipts: { email: string; id: string }[]
    privacySuppressed: boolean
    resend: boolean
    previouslyDeliveredCount: number
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to release feedback')
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
        fewer than five people responded. After release, you can deliberately
        resend the same report; concurrent clicks are still blocked.
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
        <div
          className={`border p-3 font-mono text-sm ${
            result.failedCount > 0
              ? 'border-red-600 bg-red-50 text-red-800'
              : result.inProgressCount > 0
                ? 'border-amber-700 bg-amber-50 text-amber-900'
                : 'border-black bg-green-50'
          }`}
        >
          <p>
            {result.failedCount === 0 && result.inProgressCount === 0 ? '✓ ' : ''}
            The email provider accepted {result.sentCount} of {result.totalTeachers}{' '}
            delivery{result.totalTeachers === 1 ? '' : 'ies'} in this{' '}
            {result.resend ? 'resend' : 'release'} attempt.
          </p>
          {result.previouslyDeliveredCount > 0 && (
            <p className="mt-2">
              {result.previouslyDeliveredCount} recipient
              {result.previouslyDeliveredCount === 1 ? ' was' : 's were'} already
              delivered during an earlier partial attempt and were not duplicated.
            </p>
          )}
          {result.inProgressCount > 0 && (
            <p className="mt-2">
              {result.inProgressCount} delivery attempt
              {result.inProgressCount === 1 ? ' is' : 's are'} already in progress.
            </p>
          )}
          {result.failures.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {result.failures.map((failure) => (
                <li key={failure.email}>
                  {failure.email}: {failure.message}
                </li>
              ))}
            </ul>
          )}
          {result.providerReceipts.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">Provider receipts</summary>
              <ul className="mt-1 space-y-1 pl-4">
                {result.providerReceipts.map((receipt) => (
                  <li key={`${receipt.email}-${receipt.id}`}>
                    {receipt.email}: {receipt.id}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="border border-red-600 bg-red-50 p-3 font-mono text-sm text-red-700">
          {error}
        </div>
      )}

      <Button
        onClick={handleRelease}
        disabled={loading}
      >
        {loading
          ? 'Sending...'
          : result
            ? result.failedCount > 0 || result.inProgressCount > 0
              ? 'Try Feedback Delivery Again'
              : `Resend Feedback to ${totalTeachers} Teacher${totalTeachers !== 1 ? 's' : ''}`
            : `Send / Resend Feedback to ${totalTeachers} Teacher${totalTeachers !== 1 ? 's' : ''}`
        }
      </Button>
    </div>
  )
}
