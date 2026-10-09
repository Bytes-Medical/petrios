'use client'

import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  checkInFromMeeting,
  getExternalTeacherMeetingJoin,
  getMeetingJoin,
  reportMeetingConnectError,
} from '@/app/actions/meetings'
import type { MeetingAudience, MeetingRoomView } from '@/lib/meeting/types'
import {
  CHECK_IN_RETRY_JITTER_MAX_MS,
  CHECK_IN_UNREACHABLE,
  PANEL_COPY,
  canRetryCheckInManually,
  checkInDone,
  checkInRetryDelay,
  clockOffset,
  initialPanelModel,
  isEmbedMounted,
  nextTickDelay,
  panelReducer,
  shouldAttemptCheckIn,
  type CheckInState,
  type PanelEvent,
  type PanelModel,
  type PanelState,
} from '@/lib/meeting/panel-state'
import { ROOM_OPEN_MINS_BEFORE } from '@/lib/meeting/window'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from './Button'
import { Card } from './Card'
import { LocalDateTime } from './LocalSessionDateTime'
import { MeetingEmbed } from './MeetingEmbed'

const DATE_TIME: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
}
const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }

const INFO_BOX = 'border border-dashed border-gray-300 px-4 py-3 text-gray-700'
const ERROR_BOX = 'border border-red-500 bg-red-50 px-4 py-3 text-red-800'

export interface JitsiMeetingPanelProps {
  /** Server-built by buildMeetingRoomView (mode, window, availability). */
  view: MeetingRoomView
  /** Signed-in member (session page) or accepted external teacher (RSVP page). */
  audience: MeetingAudience
}

/**
 * Petrios Meet: the session's video room.
 *
 * - JaaS / self-hosted: embedded. Every Join or Rejoin asks the server for a
 *   fresh, room-scoped pass (app/actions/meetings.ts); the server enforces
 *   the room window and who may moderate.
 * - meet.jit.si: never embedded (embedded calls are cut after 5 minutes);
 *   a plain link opens the room in a new tab.
 *
 * Members: entering the room (or opening the link) also ATTEMPTS a self
 * check-in, and the outcome is shown. spec/03 rules are unchanged.
 */
export function JitsiMeetingPanel({ view, audience }: JitsiMeetingPanelProps) {
  const headingId = useId()
  const isMember = audience.kind === 'member'

  // Initial state from the server's clock so SSR and hydration agree; the
  // first tick after mount corrects it with the skew-adjusted client clock.
  const [model, dispatch] = useReducer(
    (current: PanelModel, event: PanelEvent) => panelReducer(current, event, view),
    view,
    (initialView: MeetingRoomView) =>
      initialPanelModel(initialView, Date.parse(initialView.serverNow))
  )
  const { state } = model

  const offsetRef = useRef(0)
  const correctedNow = useCallback(() => Date.now() + offsetRef.current, [])

  useEffect(() => {
    offsetRef.current = clockOffset(view.serverNow, Date.now())
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      clearTimeout(timer)
      const now = correctedNow()
      dispatch({ type: 'TICK', now })
      timer = setTimeout(tick, nextTickDelay(view, now))
    }
    // Background tabs throttle timers; catch up as soon as the tab is visible.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    timer = setTimeout(tick, 0)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [view, correctedNow])

  // --- Room pass --------------------------------------------------------------
  const requestInFlight = useRef(false)
  const requestPass = useCallback(
    async (type: 'JOIN_REQUESTED' | 'RETRY') => {
      if (requestInFlight.current) return
      requestInFlight.current = true
      dispatch({ type })
      try {
        const result =
          audience.kind === 'external_teacher'
            ? await getExternalTeacherMeetingJoin(view.sessionId, audience.inviteCode)
            : await getMeetingJoin(view.sessionId)
        if (result.ok) {
          dispatch({ type: 'TOKEN_RECEIVED', join: result.join })
        } else {
          dispatch({
            type: 'TOKEN_FAILED',
            reason: result.reason,
            message: result.message,
            retryable: result.retryable,
            opensAt: result.opensAt,
          })
        }
      } catch {
        // Network failure or a masked server error: its text is never useful here.
        dispatch({
          type: 'TOKEN_FAILED',
          reason: 'unavailable',
          message: PANEL_COPY.unreachable,
          retryable: true,
        })
      } finally {
        requestInFlight.current = false
      }
    },
    [audience, view.sessionId]
  )

  // --- Check-in (members only, never the room's hosts) -------------------------
  const [checkIn, setCheckIn] = useState<CheckInState>({ kind: 'idle' })
  const checkInRef = useRef<CheckInState>({ kind: 'idle' })
  /** When (corrected clock, ms) to retry an early check-in; null = no retry pending. */
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const runCheckIn = useCallback(
    async (options: { moderator?: boolean } = {}) => {
      if (isMember && options.moderator) {
        // Hosts are not attendees: say so instead of a provisional check-in.
        if (checkInRef.current.kind === 'idle') {
          checkInRef.current = { kind: 'hosting' }
          setCheckIn(checkInRef.current)
        }
        return
      }
      if (!shouldAttemptCheckIn(audience.kind, checkInRef.current, options)) return
      const pending: CheckInState = { kind: 'pending' }
      checkInRef.current = pending
      setCheckIn(pending)
      let done: CheckInState
      try {
        done = checkInDone(await checkInFromMeeting(view.sessionId))
      } catch {
        done = { kind: 'done', ok: false, reason: 'failed', display: CHECK_IN_UNREACHABLE }
      }
      checkInRef.current = done
      setCheckIn(done)
      const now = correctedNow()
      const delay = checkInRetryDelay(done, now, Math.floor(Math.random() * CHECK_IN_RETRY_JITTER_MAX_MS))
      setRetryAt(delay === null ? null : now + delay)
    },
    [audience.kind, correctedNow, isMember, view.sessionId]
  )

  // Check in once per embed mount, on its first conference join.
  const checkedInAttempt = useRef(0)
  const handleJoined = useCallback(
    (attempt: number, moderator: boolean) => {
      dispatch({ type: 'CONFERENCE_JOINED' })
      if (checkedInAttempt.current === attempt) return
      checkedInAttempt.current = attempt
      void runCheckIn({ moderator })
    },
    [runCheckIn]
  )

  // Joined before check-in opened (the room opens first): retry once when it
  // opens, while the member is still in the room or on this page after
  // opening the meet.jit.si tab.
  const awaitingRoom = state.kind === 'in_room' || state.kind === 'loading' || state.kind === 'link_out'
  useEffect(() => {
    if (!awaitingRoom || retryAt === null) return
    const timer = setTimeout(() => void runCheckIn(), Math.max(0, retryAt - correctedNow()))
    return () => clearTimeout(timer)
  }, [awaitingRoom, retryAt, correctedNow, runCheckIn])
  const retryScheduled = awaitingRoom && retryAt !== null

  const handleLeft = useCallback(
    () => dispatch({ type: 'CONFERENCE_LEFT', now: correctedNow() }),
    [correctedNow]
  )
  const stateKindRef = useRef(state.kind)
  useEffect(() => {
    stateKindRef.current = state.kind
  }, [state.kind])
  const handleFatalError = useCallback(
    (name: string) => {
      // The provider's error name only (no pass, no personal data).
      console.warn('[petrios-meet] video room error:', name)
      if (stateKindRef.current === 'loading') {
        // Never got in: most likely a refused room pass, which only the
        // operator can fix. Tell the server so it reaches the logs.
        void reportMeetingConnectError(view.sessionId, name).catch(() => undefined)
      }
      dispatch({ type: 'FATAL_ERROR', now: correctedNow() })
    },
    [correctedNow, view.sessionId]
  )
  const handleLoadFailed = useCallback(() => dispatch({ type: 'LOAD_FAILED' }), [])

  // --- Focus: when the room closes, land on the next action, not <body> -------
  const headingRef = useRef<HTMLHeadingElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const previousKind = useRef(state.kind)
  useEffect(() => {
    const was = previousKind.current
    previousKind.current = state.kind
    if ((was === 'loading' || was === 'in_room') && !isEmbedMounted(state)) {
      const target =
        actionsRef.current?.querySelector<HTMLElement>('button:not([disabled]), a[href]') ??
        headingRef.current
      target?.focus()
    }
  }, [state])

  return (
    <Card className="mb-6">
      <section aria-labelledby={headingId}>
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="font-mono text-lg font-bold outline-none"
        >
          {isMember ? 'Petrios Meet: video room' : 'Your teaching room'}
        </h2>
        <p className="mt-1 font-mono text-xs text-gray-600">{introText(view, isMember)}</p>

        <div role="status" aria-live="polite" className="mt-4 space-y-2 font-mono text-sm">
          <StateMessage state={state} view={view} isMember={isMember} />
          {isMember ? (
            <CheckInLine
              checkIn={checkIn}
              retryScheduled={retryScheduled}
              onRetry={() => void runCheckIn()}
            />
          ) : null}
        </div>

        <div ref={actionsRef} className="mt-3 flex flex-wrap items-center gap-2 empty:hidden">
          <StateActions
            state={state}
            view={view}
            isMember={isMember}
            onJoin={() => void requestPass('JOIN_REQUESTED')}
            onRetry={() => void requestPass('RETRY')}
            onLeave={handleLeft}
            onOpenPublicRoom={() => {
              // Never awaited and never preventDefault: the new tab must open
              // from this click (popup blockers); check-in runs alongside.
              if (isMember) void runCheckIn({ moderator: view.viewerIsModerator })
            }}
          />
        </div>

        {isEmbedMounted(state) ? (
          <div className="mt-4">
            <MeetingEmbed
              key={state.attempt}
              join={state.join}
              sessionTitle={view.sessionTitle}
              onJoined={() => handleJoined(state.attempt, state.join.moderator)}
              onLeft={handleLeft}
              onFatalError={handleFatalError}
              onLoadFailed={handleLoadFailed}
            />
          </div>
        ) : null}
      </section>
    </Card>
  )
}

function introText(view: MeetingRoomView, isMember: boolean): string {
  if (view.mode === 'unavailable') return 'This session has a Petrios Meet video room.'
  if (!view.embedded) {
    return isMember
      ? "This session's video room runs on the free meet.jit.si service and opens in a new tab. Opening it also tries to check you in while check-in is open."
      : "This session's video room runs on the free meet.jit.si service and opens in a new tab."
  }
  return isMember
    ? 'This session has a built-in video room. Joining it also tries to check you in while check-in is open.'
    : "Join the session's video room from this page. You join as a room moderator."
}

function StateMessage({
  state,
  view,
  isMember,
}: {
  state: PanelState
  view: MeetingRoomView
  isMember: boolean
}): ReactNode {
  switch (state.kind) {
    case 'scheduled':
      return (
        <p className={INFO_BOX}>
          The room opens at <LocalDateTime value={view.opensAt} options={DATE_TIME} />,{' '}
          {ROOM_OPEN_MINS_BEFORE} minutes before the session starts.
        </p>
      )
    case 'ready':
      return (
        <>
          <p>
            The room is open. You&apos;ll join as <strong>{view.displayName}</strong>
            {isMember ? '.' : ', as a room moderator.'}
          </p>
          {isMember && view.displayNameIsFallback ? (
            <p className={INFO_BOX}>
              Your Petrios profile has no name, so the room shows you as &ldquo;{view.displayName}&rdquo;
              and you can&apos;t change it there. Ask your organiser to add your name to your
              profile so the teacher can see who you are.
            </p>
          ) : null}
        </>
      )
    case 'requesting':
      return <p>Getting your room pass…</p>
    case 'loading':
      return (
        <p>
          Opening the video room. Check your camera and microphone, then select{' '}
          <strong>Join meeting</strong>.
        </p>
      )
    case 'in_room':
      return <p>You&apos;re in the video room.</p>
    case 'left':
      return (
        <p>
          You left the video room. You can rejoin until{' '}
          <LocalDateTime value={view.closesAt} options={TIME_ONLY} />.
        </p>
      )
    case 'ended':
      return <p className={INFO_BOX}>This session has ended, so its video room is closed.</p>
    case 'not_open':
      return (
        <p className={INFO_BOX}>
          {state.reason === 'cancelled'
            ? 'This session was cancelled, so its video room is closed.'
            : 'This session is not published yet, so its video room is closed.'}
        </p>
      )
    case 'unavailable':
      return <p className={INFO_BOX}>{state.message}</p>
    case 'token_error':
      return <p className={ERROR_BOX}>{state.message}</p>
    case 'load_failed':
      return (
        <p className={ERROR_BOX}>
          The video service could not be loaded. Check your connection (some networks block video
          services), then reload the page.
        </p>
      )
    case 'link_out':
      return (
        <p>
          The room is open on meet.jit.si.{' '}
          {isMember
            ? 'The first person to arrive (usually the teacher) signs in to Jitsi to start the room; everyone else joins as a guest.'
            : 'If you arrive first, Jitsi asks you to sign in to start the room; everyone else joins as a guest.'}
        </p>
      )
  }
}

function StateActions({
  state,
  view,
  isMember,
  onJoin,
  onRetry,
  onLeave,
  onOpenPublicRoom,
}: {
  state: PanelState
  view: MeetingRoomView
  isMember: boolean
  onJoin: () => void
  onRetry: () => void
  onLeave: () => void
  onOpenPublicRoom: () => void
}): ReactNode {
  switch (state.kind) {
    case 'ready':
      return <Button onClick={onJoin}>Join video room</Button>
    case 'requesting':
      return <Button pending>Getting your room pass…</Button>
    case 'loading':
    case 'in_room':
      return (
        <Button variant="secondary" size="sm" onClick={onLeave}>
          Leave video room
        </Button>
      )
    case 'left':
      return <Button onClick={onJoin}>Rejoin video room</Button>
    case 'token_error':
      return (
        <>
          {state.retryable ? (
            <Button onClick={onRetry}>
              {state.reason === 'connection' ? 'Rejoin video room' : 'Try again'}
            </Button>
          ) : null}
          {state.reason === 'not_signed_in' && isMember ? (
            <Link
              href={`/login?next=${encodeURIComponent(`/sessions/${view.sessionId}`)}`}
              className={buttonVariants({ variant: 'secondary' })}
            >
              Sign in again
            </Link>
          ) : null}
          {state.reason === 'not_embedded' ? (
            // The deployment switched to link-out rooms after this page loaded.
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          ) : null}
        </>
      )
    case 'load_failed':
      return <Button onClick={() => window.location.reload()}>Reload page</Button>
    case 'link_out':
      return view.publicRoomUrl ? (
        <a
          href={view.publicRoomUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants()}
          onClick={onOpenPublicRoom}
        >
          Open video room (new tab)
        </a>
      ) : null
    default:
      return null
  }
}

function CheckInLine({
  checkIn,
  retryScheduled,
  onRetry,
}: {
  checkIn: CheckInState
  retryScheduled: boolean
  onRetry: () => void
}): ReactNode {
  if (checkIn.kind === 'idle') return null
  if (checkIn.kind === 'pending') {
    return <p className="text-xs text-gray-600">Checking you in…</p>
  }
  if (checkIn.kind === 'hosting') {
    return (
      <p className="text-xs text-gray-700">
        You&apos;re hosting this room, so you are not checked in as an attendee. Attendance is
        managed from Manage Session.
      </p>
    )
  }
  const { display } = checkIn
  return (
    <div className="space-y-2">
      <p
        className={cn(
          'text-xs',
          display.tone === 'success' && 'text-green-800',
          display.tone === 'notice' && 'text-gray-700',
          display.tone === 'error' && 'text-red-700'
        )}
      >
        {display.message}
        {display.window ? (
          <>
            {' '}
            Check-in is open from <LocalDateTime value={display.window.opensAt} options={DATE_TIME} />{' '}
            to <LocalDateTime value={display.window.closesAt} options={DATE_TIME} />.
          </>
        ) : null}
        {retryScheduled ? ' Stay in the room: we will check you in automatically when it opens.' : null}
      </p>
      {canRetryCheckInManually(checkIn) ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try check-in again
        </Button>
      ) : null}
    </div>
  )
}
