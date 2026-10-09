import type {
  MeetingAudience,
  MeetingCheckInResult,
  MeetingDenialReason,
  MeetingJoin,
  MeetingRoomView,
} from './types'

/**
 * Petrios Meet panel state machine (components/JitsiMeetingPanel.tsx).
 *
 * Pure and client-safe: no env, no secrets, no React. The SERVER stays
 * authoritative for the room window (it refuses to mint a room pass outside
 * it); the client uses the same inclusive window, corrected for clock skew
 * against the server's render time, only to decide what to show.
 */

/** How often the panel re-evaluates the room window (ms). */
export const PANEL_TICK_MS = 30_000
/** Floor for the next tick so a boundary a few ms away cannot spin the timer. */
export const MIN_TICK_MS = 250
/** external_api.js must load and hand over the API within this time (F12a). */
export const EMBED_LOAD_TIMEOUT_MS = 30_000
/**
 * Jitsi can emit videoConferenceLeft during an in-iframe reconnect/reload and
 * then join again; only a leave that is not followed by a join within this
 * grace closes the embed. readyToClose (a real hang-up) closes it at once.
 */
export const CONFERENCE_LEFT_GRACE_MS = 4_000

export const PANEL_COPY = {
  connectionLost: 'The video connection ended. Rejoin to get a fresh room pass.',
  connectFailed:
    "We couldn't connect you to the video room: the video service did not accept the connection. Try again; if it keeps happening, tell your organiser, as video rooms may need setting up again.",
  passExpired: 'Your room pass expired. Rejoin to get a fresh one.',
  unreachable:
    "We couldn't reach Petrios to open the video room. Check your connection and try again.",
  unavailable: 'Video rooms are unavailable right now. Please contact your organiser.',
} as const

export type RoomPhase = 'before' | 'open' | 'ended'

export type PanelState =
  /** The room window has not opened yet. */
  | { kind: 'scheduled' }
  /** Window open, embedded mode, not in the room. */
  | { kind: 'ready' }
  /** Asking the server for a room pass. */
  | { kind: 'requesting' }
  /** Embed mounted (prejoin screen or connecting). `attempt` is its React key. */
  | { kind: 'loading'; join: MeetingJoin; attempt: number }
  | { kind: 'in_room'; join: MeetingJoin; attempt: number }
  /** Hung up while the window is still open: offer Rejoin. */
  | { kind: 'left' }
  | { kind: 'ended' }
  | { kind: 'not_open'; reason: 'not_published' | 'cancelled' }
  | { kind: 'unavailable'; message: string }
  | {
      kind: 'token_error'
      /**
       * 'connection': dropped after entering the room. 'connect_failed': the
       * service refused or failed the connection BEFORE the participant got
       * in (typically a rejected room pass: an operator problem).
       */
      reason: MeetingDenialReason | 'connection' | 'connect_failed'
      message: string
      retryable: boolean
      opensAt?: string
    }
  /** external_api.js failed to load (react-sdk caches the failure: reload). */
  | { kind: 'load_failed' }
  /** Public mode (meet.jit.si) with the window open: link out, never embed. */
  | { kind: 'link_out' }

/**
 * Reducer state. `attempts` counts embed mounts so every mount gets a new
 * React key: react-sdk only builds its iframe once per mount and ignores
 * later jwt/roomName prop changes (F12b), so a fresh pass needs a fresh mount.
 */
export interface PanelModel {
  state: PanelState
  attempts: number
}

export type PanelEvent =
  /** `now` is the skew-corrected clock (ms). */
  | { type: 'TICK'; now: number }
  | { type: 'JOIN_REQUESTED' }
  | { type: 'TOKEN_RECEIVED'; join: MeetingJoin }
  | {
      type: 'TOKEN_FAILED'
      reason: MeetingDenialReason
      message: string
      retryable: boolean
      opensAt?: string
    }
  | { type: 'CONFERENCE_JOINED' }
  | { type: 'CONFERENCE_LEFT'; now: number }
  | { type: 'FATAL_ERROR'; now: number }
  /** SDK chunk / external_api.js failed or timed out (watchdog or error boundary). */
  | { type: 'LOAD_FAILED' }
  | { type: 'RETRY' }

function parseTime(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  return Date.parse(iso)
}

/** Server minus client clock (ms). 0 when the server time is unreadable. */
export function clockOffset(serverNowIso: string, clientNow: number): number {
  const server = parseTime(serverNowIso)
  if (!Number.isFinite(server) || !Number.isFinite(clientNow)) return 0
  return server - clientNow
}

/**
 * Same rule as lib/meeting/window.ts meetingRoomPhase, over the view's ISO
 * window: inclusive at both ends, unparseable times fail closed ('ended').
 */
export function roomPhaseAt(
  view: Pick<MeetingRoomView, 'opensAt' | 'closesAt'>,
  now: number
): RoomPhase {
  const opensAt = parseTime(view.opensAt)
  const closesAt = parseTime(view.closesAt)
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || !Number.isFinite(now)) {
    return 'ended'
  }
  if (now < opensAt) return 'before'
  if (now > closesAt) return 'ended'
  return 'open'
}

/**
 * Delay until the panel should next re-evaluate: the next window boundary
 * when it is closer than the regular tick, so the Join button appears at the
 * open time rather than up to a tick late.
 */
export function nextTickDelay(
  view: Pick<MeetingRoomView, 'opensAt' | 'closesAt'>,
  now: number
): number {
  const phase = roomPhaseAt(view, now)
  let untilBoundary = Number.POSITIVE_INFINITY
  if (phase === 'before') untilBoundary = parseTime(view.opensAt) - now
  // +1: the window is inclusive, so 'ended' starts 1 ms after closesAt.
  if (phase === 'open') untilBoundary = parseTime(view.closesAt) - now + 1
  return Math.max(MIN_TICK_MS, Math.min(PANEL_TICK_MS, untilBoundary))
}

/** The resting state for this view at `now` (no join in progress). */
export function initialPanelState(view: MeetingRoomView, now: number): PanelState {
  if (view.availability === 'unavailable' || view.mode === 'unavailable') {
    return { kind: 'unavailable', message: view.unavailableMessage || PANEL_COPY.unavailable }
  }
  if (view.availability === 'not_published' || view.availability === 'cancelled') {
    return { kind: 'not_open', reason: view.availability }
  }
  const phase = roomPhaseAt(view, now)
  if (phase === 'before') return { kind: 'scheduled' }
  if (phase === 'ended') return { kind: 'ended' }
  if (view.embedded) return { kind: 'ready' }
  if (view.publicRoomUrl) return { kind: 'link_out' }
  // Public mode without a room URL: nothing safe to offer.
  return { kind: 'unavailable', message: view.unavailableMessage || PANEL_COPY.unavailable }
}

export function initialPanelModel(view: MeetingRoomView, now: number): PanelModel {
  return { state: initialPanelState(view, now), attempts: 0 }
}

/**
 * Room-pass freshness. Every Join/Rejoin asks the server for a NEW pass
 * (passes are never cached between joins), so someone who stays past the
 * pass expiry and reconnects always gets a fresh one. This decides only how
 * to explain a dropped connection.
 */
export type RoomPassFreshness = 'open_room' | 'valid' | 'expired'

export function roomPassFreshness(
  join: Pick<MeetingJoin, 'jwt' | 'expiresAt'>,
  now: number
): RoomPassFreshness {
  if (join.jwt === null) return 'open_room'
  const expiresAt = parseTime(join.expiresAt)
  // A pass with no readable expiry is treated as spent.
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return 'expired'
  return 'valid'
}

/** States the clock may move between (nothing in flight, nothing mounted). */
function isRestingState(state: PanelState): boolean {
  return (
    state.kind === 'scheduled' ||
    state.kind === 'ready' ||
    state.kind === 'left' ||
    state.kind === 'ended' ||
    state.kind === 'not_open' ||
    state.kind === 'unavailable' ||
    state.kind === 'token_error' ||
    state.kind === 'link_out'
  )
}

function canRequestPass(state: PanelState): boolean {
  return (
    state.kind === 'ready' ||
    state.kind === 'left' ||
    (state.kind === 'token_error' && state.retryable)
  )
}

/**
 * Re-evaluate a resting state against the (possibly refreshed) view and the
 * clock: scheduled → ready/link_out at the open time, anything → ended after
 * the close time, and a refreshed view can close the room (status or
 * configuration changed). "You left" and error states stay put while the
 * embedded window is open so their Rejoin/Retry stays on screen.
 */
function tick(state: PanelState, now: number, view: MeetingRoomView): PanelState {
  // Never interrupt a request, a mounted room, or a load failure.
  if (!isRestingState(state)) return state
  const base = initialPanelState(view, now)
  if ((state.kind === 'left' || state.kind === 'token_error') && base.kind === 'ready') {
    return state
  }
  return sameRestingState(state, base) ? state : base
}

function sameRestingState(a: PanelState, b: PanelState): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'not_open' && b.kind === 'not_open') return a.reason === b.reason
  if (a.kind === 'unavailable' && b.kind === 'unavailable') return a.message === b.message
  // Data-carrying states are never "the same" as a freshly computed one.
  return a.kind !== 'token_error' && a.kind !== 'loading' && a.kind !== 'in_room'
}

function leftOrEnded(view: MeetingRoomView, now: number): PanelState {
  return roomPhaseAt(view, now) === 'ended' ? { kind: 'ended' } : { kind: 'left' }
}

export function panelReducer(
  model: PanelModel,
  event: PanelEvent,
  view: MeetingRoomView
): PanelModel {
  const { state } = model
  const next = (nextState: PanelState, attempts = model.attempts): PanelModel =>
    nextState === state && attempts === model.attempts ? model : { state: nextState, attempts }

  switch (event.type) {
    case 'TICK':
      return next(tick(state, event.now, view))

    case 'JOIN_REQUESTED':
    case 'RETRY':
      // Public mode never mints passes; it links out.
      if (!view.embedded || !canRequestPass(state)) return model
      return next({ kind: 'requesting' })

    case 'TOKEN_RECEIVED': {
      if (state.kind !== 'requesting') return model
      const attempt = model.attempts + 1
      return next({ kind: 'loading', join: event.join, attempt }, attempt)
    }

    case 'TOKEN_FAILED':
      if (state.kind !== 'requesting') return model
      if (event.reason === 'too_early') return next({ kind: 'scheduled' })
      if (event.reason === 'ended') return next({ kind: 'ended' })
      if (event.reason === 'not_published' || event.reason === 'cancelled') {
        return next({ kind: 'not_open', reason: event.reason })
      }
      return next({
        kind: 'token_error',
        reason: event.reason,
        message: event.message || PANEL_COPY.unavailable,
        retryable: event.retryable,
        ...(event.opensAt ? { opensAt: event.opensAt } : {}),
      })

    case 'CONFERENCE_JOINED':
      if (state.kind !== 'loading') return model
      return next({ kind: 'in_room', join: state.join, attempt: state.attempt })

    case 'CONFERENCE_LEFT':
      if (state.kind !== 'loading' && state.kind !== 'in_room') return model
      return next(leftOrEnded(view, event.now))

    case 'FATAL_ERROR': {
      if (state.kind !== 'loading' && state.kind !== 'in_room') return model
      if (roomPhaseAt(view, event.now) === 'ended') return next({ kind: 'ended' })
      const expired = roomPassFreshness(state.join, event.now) === 'expired'
      if (expired) {
        return next({ kind: 'token_error', reason: 'connection', message: PANEL_COPY.passExpired, retryable: true })
      }
      // Never got in: not a "connection ended". A valid pass refused at
      // connect points at the deployment (key/claims), so say so.
      if (state.kind === 'loading') {
        return next({ kind: 'token_error', reason: 'connect_failed', message: PANEL_COPY.connectFailed, retryable: true })
      }
      return next({ kind: 'token_error', reason: 'connection', message: PANEL_COPY.connectionLost, retryable: true })
    }

    case 'LOAD_FAILED':
      if (state.kind !== 'loading') return model
      return next({ kind: 'load_failed' })
  }
}

/** The embed is mounted in these states. */
export function isEmbedMounted(
  state: PanelState
): state is Extract<PanelState, { kind: 'loading' | 'in_room' }> {
  return state.kind === 'loading' || state.kind === 'in_room'
}

// ---------------------------------------------------------------------------
// Check-in outcome (members only). Joining is an ATTEMPT at SELF_CHECKIN; the
// server keeps every spec/03 rule. The panel shows the outcome, never hides it.
// ---------------------------------------------------------------------------

export type CheckInTone = 'success' | 'notice' | 'error'

export interface CheckInDisplay {
  tone: CheckInTone
  message: string
  /** Self check-in window to show (outside_window only). */
  window: { opensAt: string; closesAt: string } | null
}

export type CheckInState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  /** The viewer hosts the room (moderator pass): no attendee check-in. */
  | { kind: 'hosting' }
  | {
      kind: 'done'
      ok: boolean
      reason: Extract<MeetingCheckInResult, { ok: false }>['reason'] | null
      display: CheckInDisplay
    }

const CHECK_IN_FALLBACK: Record<Extract<MeetingCheckInResult, { ok: false }>['reason'], string> = {
  not_signed_in: 'Sign in again to record your check-in.',
  not_available: 'Check-in is not available for this session.',
  finalized:
    'Attendance for this session has been finalized. Contact the moderator if your result needs review.',
  outside_window: 'Check-in is not open right now.',
  code_required:
    'This session uses a session code. Enter the code your organiser shares in the Check in panel on this page.',
  failed: "We couldn't record your check-in. Use the Check in panel on this page.",
}

const CHECK_IN_SUCCESS_FALLBACK =
  "You're checked in. Your attendance stays provisional until the moderator finalizes it."

/** Shown when the check-in request itself never got an answer. */
export const CHECK_IN_UNREACHABLE: CheckInDisplay = {
  tone: 'error',
  message:
    "We couldn't reach Petrios to record your check-in. Use the Check in panel on this page.",
  window: null,
}

export function describeCheckIn(result: MeetingCheckInResult): CheckInDisplay {
  if (result.ok) {
    return { tone: 'success', message: result.message.trim() || CHECK_IN_SUCCESS_FALLBACK, window: null }
  }
  const tone: CheckInTone =
    result.reason === 'outside_window' ||
    result.reason === 'code_required' ||
    result.reason === 'finalized'
      ? 'notice'
      : 'error'
  const window =
    result.reason === 'outside_window' &&
    result.window &&
    Number.isFinite(parseTime(result.window.opensAt)) &&
    Number.isFinite(parseTime(result.window.closesAt))
      ? { opensAt: result.window.opensAt, closesAt: result.window.closesAt }
      : null
  return { tone, message: result.message.trim() || CHECK_IN_FALLBACK[result.reason], window }
}

export function checkInDone(result: MeetingCheckInResult): CheckInState {
  return {
    kind: 'done',
    ok: result.ok,
    reason: result.ok ? null : result.reason,
    display: describeCheckIn(result),
  }
}

/**
 * Members only, and never the room's hosts. A check-in that already succeeded or hit finalized
 * attendance is not repeated on rejoin (the server would only say the same
 * thing); any other outcome — window not open yet, a transient failure — is
 * tried again, which is safe because SELF_CHECKIN is idempotent per user.
 */
export function shouldAttemptCheckIn(
  audience: MeetingAudience['kind'],
  checkIn: CheckInState,
  options: { moderator?: boolean } = {}
): boolean {
  if (audience !== 'member') return false
  // Department moderators and accepted teachers host the room; their
  // attendance is managed from Manage Session, not self check-in.
  if (options.moderator) return false
  if (checkIn.kind === 'pending' || checkIn.kind === 'hosting') return false
  if (checkIn.kind === 'done' && (checkIn.ok || checkIn.reason === 'finalized')) return false
  return true
}

/** Spread for the automatic check-in retry so a whole cohort does not hit the server in the same second. */
export const CHECK_IN_RETRY_JITTER_MAX_MS = 5_000

/**
 * The room opens before self check-in does (30 vs 15 minutes by default), so
 * a member who joins early gets 'outside_window'. While they stay in the
 * room (or on the page after opening the meet.jit.si tab) the panel retries
 * ONCE when the window opens: the delay (ms, on the skew-corrected clock)
 * until opensAt plus jitter. Null when there is nothing to wait for: any
 * other outcome, an unreadable window, or a window that already opened or
 * closed (a manual "Try check-in again" covers those).
 */
export function checkInRetryDelay(checkIn: CheckInState, now: number, jitterMs = 0): number | null {
  if (checkIn.kind !== 'done' || checkIn.ok || checkIn.reason !== 'outside_window') return null
  const opensAt = parseTime(checkIn.display.window?.opensAt)
  const closesAt = parseTime(checkIn.display.window?.closesAt)
  if (!Number.isFinite(opensAt) || !Number.isFinite(closesAt) || !Number.isFinite(now)) return null
  if (now >= opensAt || opensAt > closesAt) return null
  return opensAt - now + Math.min(Math.max(0, jitterMs), CHECK_IN_RETRY_JITTER_MAX_MS)
}

/** A manual retry makes sense only after a failure to reach or record the check-in. */
export function canRetryCheckInManually(checkIn: CheckInState): boolean {
  return checkIn.kind === 'done' && !checkIn.ok && checkIn.reason === 'failed'
}
