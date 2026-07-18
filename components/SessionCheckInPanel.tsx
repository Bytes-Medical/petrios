'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkIn } from '@/app/actions/attendance'
import type { Session } from '@/lib/types'
import { Button } from './Button'

export function SessionCheckInPanel({
  session,
  serverNow,
}: {
  session: Session
  serverNow: string
}) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (session.status !== 'PUBLISHED') return null
  if (session.attendance_phase === 'FINALIZED') {
    return (
      <p className="mb-4 border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-700">
        Attendance has been finalized. Contact the session moderator if your result needs review.
      </p>
    )
  }

  const start = new Date(session.date_start).getTime()
  const opensAt = start - (session.checkin_open_mins_before ?? 15) * 60 * 1000
  const closesAt = start + (session.checkin_close_mins_after ?? 45) * 60 * 1000
  const now = new Date(serverNow).getTime()
  const beforeWindow = now < opensAt
  const afterWindow = now > closesAt

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const submittedCode = code.trim() || undefined
      await checkIn(session.id, submittedCode)
      setMessage('Check-in recorded. Your result remains provisional until the moderator finalizes attendance.')
      setCode('')
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Check-in failed')
    } finally {
      setBusy(false)
    }
  }

  if (beforeWindow || afterWindow) {
    return (
      <p className="mb-4 border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-700">
        {beforeWindow
          ? `Check-in opens ${new Date(opensAt).toLocaleString('en-GB')}.`
          : 'The check-in window is closed. A moderator can make a reasoned correction during review.'}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 border border-black p-4">
      <div>
        <p className="font-mono text-sm font-bold">Check in</p>
        <p className="mt-1 font-mono text-xs text-gray-600">
          If the organiser has announced a six-character session code, enter it here. Once a code is active, plain self check-in is disabled.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Session group code"
          placeholder="Session code (if announced)"
          className="min-w-0 flex-1 border border-black px-3 py-2 font-mono text-sm uppercase tracking-[0.2em]"
        />
        <Button type="submit" disabled={busy}>{busy ? 'Checking in…' : 'Check in'}</Button>
      </div>
      {message ? <p className="font-mono text-xs text-green-800">{message}</p> : null}
      {error ? <p className="font-mono text-xs text-red-700">{error}</p> : null}
    </form>
  )
}
