import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fatalErrorMessage, startLoadWatchdog, wireMeetingEvents } from './embed-events'
import { CONFERENCE_LEFT_GRACE_MS, EMBED_LOAD_TIMEOUT_MS } from './panel-state'

/** Minimal stand-in for the Jitsi External API's EventEmitter. */
class FakeApi {
  private listeners = new Map<string, ((...args: unknown[]) => void)[]>()

  addListener(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
    return this
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args)
  }
}

function setup() {
  const api = new FakeApi()
  const callbacks = { onJoined: vi.fn(), onLeft: vi.fn(), onFatalError: vi.fn() }
  const teardown = wireMeetingEvents(api, callbacks)
  return { api, callbacks, teardown }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('wireMeetingEvents', () => {
  it('reports a join', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceJoined', { roomName: 'petrios-x' })
    expect(callbacks.onJoined).toHaveBeenCalledTimes(1)
  })

  it('does not close the room when a leave is followed by a join within the grace (in-iframe reconnect)', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceJoined')
    api.emit('videoConferenceLeft', { roomName: 'petrios-x' })
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS - 1)
    api.emit('videoConferenceJoined')
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS * 2)
    expect(callbacks.onLeft).not.toHaveBeenCalled()
    expect(callbacks.onJoined).toHaveBeenCalledTimes(2)
  })

  it('closes the room once, after the grace, when no rejoin follows a leave', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceLeft')
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS - 1)
    expect(callbacks.onLeft).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(callbacks.onLeft).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS * 2)
    expect(callbacks.onLeft).toHaveBeenCalledTimes(1)
  })

  it('a repeated leave restarts the grace rather than closing twice', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceLeft')
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS - 10)
    api.emit('videoConferenceLeft')
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS)
    expect(callbacks.onLeft).toHaveBeenCalledTimes(1)
  })

  it('closes at once on readyToClose (a real hang-up) and cancels a pending grace timer', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceLeft')
    api.emit('readyToClose')
    expect(callbacks.onLeft).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS * 2)
    expect(callbacks.onLeft).toHaveBeenCalledTimes(1)
  })

  it('ignores non-fatal errors', () => {
    const { api, callbacks } = setup()
    api.emit('errorOccurred', { name: 'conference.audioMuted', type: 'CONFERENCE', isFatal: false })
    api.emit('errorOccurred', { name: 'x' })
    api.emit('errorOccurred', null)
    expect(callbacks.onFatalError).not.toHaveBeenCalled()
  })

  it('reports a fatal error by name and cancels a pending leave', () => {
    const { api, callbacks } = setup()
    api.emit('videoConferenceLeft')
    api.emit('errorOccurred', {
      name: 'conference.connectionError.notAllowed',
      message: 'not allowed',
      type: 'CONNECTION',
      isFatal: true,
    })
    expect(callbacks.onFatalError).toHaveBeenCalledWith('conference.connectionError.notAllowed')
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS * 2)
    expect(callbacks.onLeft).not.toHaveBeenCalled()
  })

  it('teardown cancels a pending leave and ignores every later event (no callbacks after unmount)', () => {
    const { api, callbacks, teardown } = setup()
    api.emit('videoConferenceLeft')
    teardown()
    vi.advanceTimersByTime(CONFERENCE_LEFT_GRACE_MS * 2)
    api.emit('videoConferenceJoined')
    api.emit('readyToClose')
    api.emit('errorOccurred', { name: 'connection.otherError', isFatal: true })
    expect(callbacks.onLeft).not.toHaveBeenCalled()
    expect(callbacks.onJoined).not.toHaveBeenCalled()
    expect(callbacks.onFatalError).not.toHaveBeenCalled()
  })
})

describe('fatalErrorMessage', () => {
  it('prefers the name, then the message, then a generic label', () => {
    expect(fatalErrorMessage({ isFatal: true, name: 'connection.droppedError', message: 'm' })).toBe(
      'connection.droppedError'
    )
    expect(fatalErrorMessage({ isFatal: true, name: '', message: 'Connection lost' })).toBe('Connection lost')
    expect(fatalErrorMessage({ isFatal: true })).toBe('fatal error')
  })

  it('is null unless isFatal is exactly true', () => {
    expect(fatalErrorMessage({ isFatal: 'true', name: 'x' })).toBeNull()
    expect(fatalErrorMessage(undefined)).toBeNull()
    expect(fatalErrorMessage('boom')).toBeNull()
  })
})

describe('startLoadWatchdog', () => {
  it('reports a load failure when the API never arrives', () => {
    const onLoadFailed = vi.fn()
    startLoadWatchdog(() => false, onLoadFailed)
    vi.advanceTimersByTime(EMBED_LOAD_TIMEOUT_MS - 1)
    expect(onLoadFailed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onLoadFailed).toHaveBeenCalledTimes(1)
  })

  it('stays quiet when the API arrived, or when cancelled on unmount', () => {
    const ready = vi.fn()
    startLoadWatchdog(() => true, ready)
    const cancelled = vi.fn()
    const cancel = startLoadWatchdog(() => false, cancelled)
    cancel()
    vi.advanceTimersByTime(EMBED_LOAD_TIMEOUT_MS * 2)
    expect(ready).not.toHaveBeenCalled()
    expect(cancelled).not.toHaveBeenCalled()
  })
})
