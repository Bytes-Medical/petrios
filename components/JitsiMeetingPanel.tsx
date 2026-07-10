'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { checkIn } from '@/app/actions/attendance'
import { JITSI_DOMAIN, jitsiMeetingUrl, jitsiRoomName } from '@/lib/jitsi'
import { Button } from './Button'
import { Card } from './Card'

// The SDK injects Jitsi's external_api.js into the page, so it can only
// ever render client-side.
const JitsiMeeting = dynamic(
  () => import('@jitsi/react-sdk').then((m) => m.JitsiMeeting),
  { ssr: false }
)

interface JitsiMeetingPanelProps {
  sessionId: string
  sessionTitle: string
  dateStart: string
  dateEnd: string
  /** Shown to other participants in the room. */
  displayName: string
}

/** The room is joinable from 30 min before start until 30 min after end. */
const ROOM_OPEN_MINS_BEFORE = 30
const ROOM_CLOSE_MINS_AFTER = 30

/**
 * Byte Meet: the session's built-in video room, embedded in the session
 * page. Joining fires the normal self check-in (best-effort — outside the
 * check-in window it simply doesn't record, matching existing semantics).
 */
export function JitsiMeetingPanel({
  sessionId,
  sessionTitle,
  dateStart,
  dateEnd,
  displayName,
}: JitsiMeetingPanelProps) {
  const [joined, setJoined] = useState(false)
  const checkedIn = useRef(false)

  // Clock as state (render must stay pure); the minute tick also makes the
  // Join button appear/disappear without a page refresh.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const opensAt = new Date(dateStart).getTime() - ROOM_OPEN_MINS_BEFORE * 60 * 1000
  const closesAt = new Date(dateEnd).getTime() + ROOM_CLOSE_MINS_AFTER * 60 * 1000

  const roomUrl = jitsiMeetingUrl(sessionId)

  function handleApiReady(api: { addListener: (event: string, cb: () => void) => void }) {
    api.addListener('videoConferenceJoined', () => {
      if (checkedIn.current) return
      checkedIn.current = true
      // Attendance evidence, not a hard requirement to be in the room.
      checkIn(sessionId).catch(() => {})
    })
  }

  return (
    <Card className="mb-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-mono text-lg font-bold">Byte Meet — video room</h2>
          <p className="font-mono text-xs text-gray-600">
            This session has a built-in video room. Joining here also checks
            you in when the attendance window is open.
          </p>
        </div>
        {!joined && now >= opensAt && now <= closesAt && (
          <Button onClick={() => setJoined(true)}>Join teaching room</Button>
        )}
      </div>

      {now < opensAt && (
        <p className="mt-4 border border-dashed border-gray-300 px-4 py-3 font-mono text-sm text-gray-600">
          The room opens at{' '}
          {new Date(opensAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{' '}
          ({ROOM_OPEN_MINS_BEFORE} minutes before the session starts).
        </p>
      )}

      {now > closesAt && (
        <p className="mt-4 border border-dashed border-gray-300 px-4 py-3 font-mono text-sm text-gray-600">
          This session has ended, so the room is closed.
        </p>
      )}

      {joined && (
        <div className="mt-4 border border-black">
          <JitsiMeeting
            domain={JITSI_DOMAIN}
            roomName={jitsiRoomName(sessionId)}
            userInfo={{ displayName, email: '' }}
            configOverwrite={{
              prejoinConfig: { enabled: true },
              disableDeepLinking: true,
              startWithAudioMuted: true,
              subject: sessionTitle,
            }}
            onApiReady={handleApiReady}
            onReadyToClose={() => setJoined(false)}
            getIFrameRef={(iframeRef) => {
              iframeRef.style.height = '600px'
              iframeRef.style.width = '100%'
            }}
          />
        </div>
      )}

      <p className="mt-3 font-mono text-[11px] text-gray-500">
        Room link (for guests without an account):{' '}
        <a href={roomUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {roomUrl}
        </a>
        {JITSI_DOMAIN === 'meet.jit.si' &&
          ' — the first person to arrive may be asked to sign in to Jitsi to open the room.'}
      </p>
    </Card>
  )
}
