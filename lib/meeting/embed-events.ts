/**
 * Jitsi External API event wiring for the embedded Petrios Meet room
 * (components/MeetingEmbed.tsx). Pure and client-safe: it only needs
 * something with addListener (the IJitsiMeetExternalApi EventEmitter) and a
 * timer API, so it is unit-tested with a fake emitter and fake timers.
 *
 * Event names are the documented iframe API events
 * (https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe-events):
 *   videoConferenceJoined  the local participant entered the conference
 *   videoConferenceLeft    the local participant left; also emitted during an
 *                          in-iframe reconnect that is followed by a join
 *   readyToClose           hang-up finished: the iframe can be removed
 *   errorOccurred          { name, message?, type, isFatal, details? } (flat)
 */

import { CONFERENCE_LEFT_GRACE_MS, EMBED_LOAD_TIMEOUT_MS } from './panel-state'

export interface MeetingEventSource {
  addListener(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface MeetingEventCallbacks {
  /** Entered the conference (past the prejoin screen). */
  onJoined(): void
  /** Hung up / closed the room (or a leave not followed by a rejoin). */
  onLeft(): void
  /** The provider reported a FATAL error; `name` is its identifier only. */
  onFatalError(name: string): void
}

export interface TimerApi {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const defaultTimers: TimerApi = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * The identifier of a FATAL `errorOccurred` payload, or null for non-fatal
 * (or malformed) payloads. Prefers the error name, then its message, then
 * 'fatal error'. Never returns token or user data (the payload carries none).
 */
export function fatalErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const error = payload as { isFatal?: unknown; name?: unknown; message?: unknown }
  if (error.isFatal !== true) return null
  if (typeof error.name === 'string' && error.name) return error.name
  if (typeof error.message === 'string' && error.message) return error.message
  return 'fatal error'
}

/**
 * Attach the room's lifecycle listeners. Returns a teardown that cancels a
 * pending leave timer and ignores every later event (the embed calls it on
 * unmount, before api.dispose()).
 *
 *   - videoConferenceLeft starts a grace timer; a videoConferenceJoined
 *     within it cancels the leave (in-iframe reconnect), otherwise onLeft.
 *   - readyToClose is a real hang-up: onLeft at once, cancelling any timer.
 *   - errorOccurred with isFatal === true: cancel the timer, onFatalError.
 */
export function wireMeetingEvents(
  api: MeetingEventSource,
  callbacks: MeetingEventCallbacks,
  options: { timers?: TimerApi; graceMs?: number } = {}
): () => void {
  const timers = options.timers ?? defaultTimers
  const graceMs = options.graceMs ?? CONFERENCE_LEFT_GRACE_MS
  let leftTimer: unknown = null
  let active = true

  const clearLeftTimer = () => {
    if (leftTimer !== null) {
      timers.clearTimeout(leftTimer)
      leftTimer = null
    }
  }

  api.addListener('videoConferenceJoined', () => {
    if (!active) return
    clearLeftTimer()
    callbacks.onJoined()
  })
  api.addListener('videoConferenceLeft', () => {
    if (!active) return
    clearLeftTimer()
    leftTimer = timers.setTimeout(() => {
      leftTimer = null
      if (active) callbacks.onLeft()
    }, graceMs)
  })
  api.addListener('readyToClose', () => {
    if (!active) return
    clearLeftTimer()
    callbacks.onLeft()
  })
  api.addListener('errorOccurred', (payload: unknown) => {
    if (!active) return
    const fatal = fatalErrorMessage(payload)
    if (fatal === null) return
    clearLeftTimer()
    callbacks.onFatalError(fatal)
  })

  return () => {
    active = false
    clearLeftTimer()
  }
}

/**
 * The SDK never reports a failed external_api.js load (design F12a): if the
 * API has not been handed over within the timeout, report a load failure.
 * Returns a cancel function.
 */
export function startLoadWatchdog(
  isReady: () => boolean,
  onLoadFailed: () => void,
  options: { timers?: TimerApi; timeoutMs?: number } = {}
): () => void {
  const timers = options.timers ?? defaultTimers
  const handle = timers.setTimeout(() => {
    if (!isReady()) onLoadFailed()
  }, options.timeoutMs ?? EMBED_LOAD_TIMEOUT_MS)
  return () => timers.clearTimeout(handle)
}
