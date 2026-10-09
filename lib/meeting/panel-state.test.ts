import { describe, expect, it } from 'vitest'
import {
  CHECK_IN_RETRY_JITTER_MAX_MS,
  CHECK_IN_UNREACHABLE,
  MIN_TICK_MS,
  canRetryCheckInManually,
  checkInRetryDelay,
  PANEL_COPY,
  PANEL_TICK_MS,
  checkInDone,
  clockOffset,
  describeCheckIn,
  initialPanelModel,
  initialPanelState,
  isEmbedMounted,
  nextTickDelay,
  panelReducer,
  roomPassFreshness,
  roomPhaseAt,
  shouldAttemptCheckIn,
  type CheckInState,
  type PanelEvent,
  type PanelModel,
  type PanelState,
} from './panel-state'
import type { MeetingJoin, MeetingRoomView } from './types'

const MINUTE = 60_000
const OPENS = Date.parse('2026-10-09T09:30:00.000Z')
const CLOSES = Date.parse('2026-10-09T11:30:00.000Z')
const DURING = OPENS + 30 * MINUTE

function view(overrides: Partial<MeetingRoomView> = {}): MeetingRoomView {
  return {
    sessionId: '0b9f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    sessionTitle: 'Acute kidney injury',
    mode: 'jaas',
    embedded: true,
    availability: 'ready',
    opensAt: new Date(OPENS).toISOString(),
    closesAt: new Date(CLOSES).toISOString(),
    serverNow: new Date(DURING).toISOString(),
    publicRoomUrl: null,
    displayName: 'Grace Hopper',
    displayNameIsFallback: false,
    viewerIsModerator: false,
    unavailableMessage: null,
    ...overrides,
  }
}

const publicView = (overrides: Partial<MeetingRoomView> = {}) =>
  view({
    mode: 'public',
    embedded: false,
    publicRoomUrl: 'https://meet.jit.si/Petrios-0b9f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    ...overrides,
  })

function join(overrides: Partial<MeetingJoin> = {}): MeetingJoin {
  return {
    domain: '8x8.vc',
    roomName: 'vpaas-magic-cookie-abc/Petrios-0b9f1c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e',
    jwt: 'header.payload.signature-1',
    expiresAt: new Date(CLOSES).toISOString(),
    moderator: false,
    displayName: 'Grace Hopper',
    ...overrides,
  }
}

function model(state: PanelState, attempts = 0): PanelModel {
  return { state, attempts }
}

function run(start: PanelModel, events: PanelEvent[], v: MeetingRoomView = view()): PanelModel {
  return events.reduce((current, event) => panelReducer(current, event, v), start)
}

describe('roomPhaseAt', () => {
  it('is inclusive at both ends of the room window', () => {
    const v = view()
    expect(roomPhaseAt(v, OPENS - 1)).toBe('before')
    expect(roomPhaseAt(v, OPENS)).toBe('open')
    expect(roomPhaseAt(v, CLOSES)).toBe('open')
    expect(roomPhaseAt(v, CLOSES + 1)).toBe('ended')
  })

  it('fails closed on unreadable times', () => {
    expect(roomPhaseAt(view({ opensAt: 'not a date' }), DURING)).toBe('ended')
    expect(roomPhaseAt(view(), Number.NaN)).toBe('ended')
  })
})

describe('initialPanelState', () => {
  it('shows a configuration problem before anything else', () => {
    const state = initialPanelState(
      view({ mode: 'unavailable', embedded: false, availability: 'unavailable', unavailableMessage: 'Video rooms are unavailable right now.' }),
      DURING
    )
    expect(state).toEqual({ kind: 'unavailable', message: 'Video rooms are unavailable right now.' })
  })

  it('falls back to the generic unavailable copy when the view has none', () => {
    expect(initialPanelState(view({ availability: 'unavailable' }), DURING)).toEqual({
      kind: 'unavailable',
      message: PANEL_COPY.unavailable,
    })
  })

  it('keeps draft and cancelled rooms closed whatever the time', () => {
    expect(initialPanelState(view({ availability: 'not_published' }), DURING)).toEqual({
      kind: 'not_open',
      reason: 'not_published',
    })
    expect(initialPanelState(view({ availability: 'cancelled' }), DURING)).toEqual({
      kind: 'not_open',
      reason: 'cancelled',
    })
  })

  it('maps the room window to scheduled / ready / ended for embedded rooms', () => {
    expect(initialPanelState(view(), OPENS - 1).kind).toBe('scheduled')
    expect(initialPanelState(view(), OPENS).kind).toBe('ready')
    expect(initialPanelState(view(), CLOSES).kind).toBe('ready')
    expect(initialPanelState(view(), CLOSES + 1).kind).toBe('ended')
  })

  it('links out (never embeds) in public mode', () => {
    expect(initialPanelState(publicView(), DURING).kind).toBe('link_out')
    expect(initialPanelState(publicView(), OPENS - 1).kind).toBe('scheduled')
    expect(initialPanelState(publicView(), CLOSES + 1).kind).toBe('ended')
  })

  it('offers nothing in public mode without a room URL', () => {
    expect(initialPanelState(publicView({ publicRoomUrl: null }), DURING).kind).toBe('unavailable')
  })

  it('starts with no embed mounts', () => {
    expect(initialPanelModel(view(), DURING)).toEqual({ state: { kind: 'ready' }, attempts: 0 })
  })
})

describe('TICK', () => {
  it('opens the room exactly at opensAt', () => {
    const scheduled = model({ kind: 'scheduled' })
    expect(panelReducer(scheduled, { type: 'TICK', now: OPENS - 1 }, view())).toBe(scheduled)
    expect(panelReducer(scheduled, { type: 'TICK', now: OPENS }, view()).state).toEqual({ kind: 'ready' })
    expect(panelReducer(scheduled, { type: 'TICK', now: OPENS }, publicView()).state).toEqual({
      kind: 'link_out',
    })
  })

  it('closes a resting room just after closesAt', () => {
    for (const kind of ['ready', 'left', 'link_out'] as const) {
      const start = model({ kind })
      const v = kind === 'link_out' ? publicView() : view()
      expect(panelReducer(start, { type: 'TICK', now: CLOSES }, v)).toBe(start)
      expect(panelReducer(start, { type: 'TICK', now: CLOSES + 1 }, v).state).toEqual({ kind: 'ended' })
    }
  })

  it('never interrupts a mounted room, a pass request or a load failure', () => {
    const mounted: PanelState[] = [
      { kind: 'in_room', join: join(), attempt: 1 },
      { kind: 'loading', join: join(), attempt: 1 },
      { kind: 'requesting' },
      { kind: 'load_failed' },
    ]
    for (const state of mounted) {
      const start = model(state, 1)
      expect(panelReducer(start, { type: 'TICK', now: CLOSES + 60 * MINUTE }, view())).toBe(start)
      expect(
        panelReducer(start, { type: 'TICK', now: DURING }, view({ availability: 'cancelled' }))
      ).toBe(start)
    }
  })

  it('keeps "you left" and errors on screen while the window is open', () => {
    const left = model({ kind: 'left' }, 1)
    expect(panelReducer(left, { type: 'TICK', now: DURING }, view())).toBe(left)
    const error = model(
      { kind: 'token_error', reason: 'unavailable', message: 'x', retryable: true },
      1
    )
    expect(panelReducer(error, { type: 'TICK', now: DURING }, view())).toBe(error)
    expect(panelReducer(error, { type: 'TICK', now: CLOSES + 1 }, view()).state.kind).toBe('ended')
  })

  it('follows a refreshed view that closed the room or changed mode', () => {
    expect(
      panelReducer(model({ kind: 'ready' }), { type: 'TICK', now: DURING }, view({ availability: 'cancelled' }))
        .state
    ).toEqual({ kind: 'not_open', reason: 'cancelled' })
    expect(
      panelReducer(model({ kind: 'not_open', reason: 'not_published' }), { type: 'TICK', now: DURING }, view())
        .state
    ).toEqual({ kind: 'ready' })
    // A Rejoin button would do nothing once the deployment links out instead.
    expect(panelReducer(model({ kind: 'left' }), { type: 'TICK', now: DURING }, publicView()).state).toEqual({
      kind: 'link_out',
    })
  })

  it('returns the same model when nothing changed (no re-render)', () => {
    const ready = model({ kind: 'ready' })
    expect(panelReducer(ready, { type: 'TICK', now: DURING }, view())).toBe(ready)
    const unavailable = model({ kind: 'unavailable', message: PANEL_COPY.unavailable })
    expect(
      panelReducer(unavailable, { type: 'TICK', now: DURING }, view({ availability: 'unavailable' }))
    ).toBe(unavailable)
  })
})

describe('joining', () => {
  it('requests a pass, then mounts the embed with a new attempt key', () => {
    const pass = join()
    const requesting = panelReducer(model({ kind: 'ready' }), { type: 'JOIN_REQUESTED' }, view())
    expect(requesting.state).toEqual({ kind: 'requesting' })
    const loading = panelReducer(requesting, { type: 'TOKEN_RECEIVED', join: pass }, view())
    expect(loading).toEqual({ state: { kind: 'loading', join: pass, attempt: 1 }, attempts: 1 })
    expect(isEmbedMounted(loading.state)).toBe(true)
  })

  it('ignores Join in public mode and outside a joinable state', () => {
    const ready = model({ kind: 'ready' })
    expect(panelReducer(ready, { type: 'JOIN_REQUESTED' }, publicView())).toBe(ready)
    for (const state of [
      { kind: 'scheduled' },
      { kind: 'ended' },
      { kind: 'requesting' },
      { kind: 'in_room', join: join(), attempt: 1 },
    ] as PanelState[]) {
      const start = model(state, 1)
      expect(panelReducer(start, { type: 'JOIN_REQUESTED' }, view())).toBe(start)
    }
  })

  it('ignores a pass that arrives when no request is pending', () => {
    const ready = model({ kind: 'ready' })
    expect(panelReducer(ready, { type: 'TOKEN_RECEIVED', join: join() }, view())).toBe(ready)
  })

  it('moves to in_room on the conference join, keeping the pass and key', () => {
    const pass = join({ moderator: true })
    const joined = run(model({ kind: 'ready' }), [
      { type: 'JOIN_REQUESTED' },
      { type: 'TOKEN_RECEIVED', join: pass },
      { type: 'CONFERENCE_JOINED' },
    ])
    expect(joined.state).toEqual({ kind: 'in_room', join: pass, attempt: 1 })
    const ready = model({ kind: 'ready' })
    expect(panelReducer(ready, { type: 'CONFERENCE_JOINED' }, view())).toBe(ready)
  })

  it('rejoin after leaving always mints a fresh pass and remounts', () => {
    const first = join({ jwt: 'pass-1' })
    const second = join({ jwt: 'pass-2' })
    const left = run(model({ kind: 'ready' }), [
      { type: 'JOIN_REQUESTED' },
      { type: 'TOKEN_RECEIVED', join: first },
      { type: 'CONFERENCE_JOINED' },
      { type: 'CONFERENCE_LEFT', now: DURING },
    ])
    expect(left).toEqual({ state: { kind: 'left' }, attempts: 1 })

    // The old pass is not kept anywhere: Rejoin has to go back to the server.
    const rejoining = panelReducer(left, { type: 'JOIN_REQUESTED' }, view())
    expect(rejoining.state).toEqual({ kind: 'requesting' })

    const remounted = panelReducer(rejoining, { type: 'TOKEN_RECEIVED', join: second }, view())
    expect(remounted.state).toEqual({ kind: 'loading', join: second, attempt: 2 })
    expect(remounted.attempts).toBe(2)
  })
})

describe('TOKEN_FAILED', () => {
  const requesting = model({ kind: 'requesting' })
  const fail = (reason: Extract<PanelEvent, { type: 'TOKEN_FAILED' }>['reason'], extra = {}) =>
    panelReducer(
      requesting,
      { type: 'TOKEN_FAILED', reason, message: `server says ${reason}`, retryable: false, ...extra },
      view()
    ).state

  it('returns to the schedule or the end when the server clock disagrees', () => {
    expect(fail('too_early', { retryable: true, opensAt: new Date(OPENS).toISOString() })).toEqual({
      kind: 'scheduled',
    })
    expect(fail('ended')).toEqual({ kind: 'ended' })
  })

  it('shows a closed room when the session changed status', () => {
    expect(fail('cancelled')).toEqual({ kind: 'not_open', reason: 'cancelled' })
    expect(fail('not_published')).toEqual({ kind: 'not_open', reason: 'not_published' })
  })

  it('keeps the reason, message and retry flag for everything else', () => {
    expect(fail('not_signed_in')).toEqual({
      kind: 'token_error',
      reason: 'not_signed_in',
      message: 'server says not_signed_in',
      retryable: false,
    })
    expect(fail('unavailable', { retryable: true })).toMatchObject({
      kind: 'token_error',
      reason: 'unavailable',
      retryable: true,
    })
  })

  it('never shows an empty error', () => {
    const state = panelReducer(
      requesting,
      { type: 'TOKEN_FAILED', reason: 'unavailable', message: '', retryable: true },
      view()
    ).state
    expect(state).toMatchObject({ kind: 'token_error', message: PANEL_COPY.unavailable })
  })

  it('lets only retryable errors retry', () => {
    const retryable = model({ kind: 'token_error', reason: 'unavailable', message: 'x', retryable: true })
    expect(panelReducer(retryable, { type: 'RETRY' }, view()).state).toEqual({ kind: 'requesting' })
    const final = model({ kind: 'token_error', reason: 'not_found', message: 'x', retryable: false })
    expect(panelReducer(final, { type: 'RETRY' }, view())).toBe(final)
    expect(panelReducer(final, { type: 'JOIN_REQUESTED' }, view())).toBe(final)
  })
})

describe('leaving and failures inside the room', () => {
  const inRoom = (pass: MeetingJoin = join()) => model({ kind: 'in_room', join: pass, attempt: 1 }, 1)

  it('hang-up leaves a rejoinable room, or an ended one after close', () => {
    expect(panelReducer(inRoom(), { type: 'CONFERENCE_LEFT', now: DURING }, view()).state).toEqual({
      kind: 'left',
    })
    expect(panelReducer(inRoom(), { type: 'CONFERENCE_LEFT', now: CLOSES + 1 }, view()).state).toEqual({
      kind: 'ended',
    })
    // Closing from the prejoin screen.
    const loading = model({ kind: 'loading', join: join(), attempt: 1 }, 1)
    expect(panelReducer(loading, { type: 'CONFERENCE_LEFT', now: DURING }, view()).state.kind).toBe('left')
    const ready = model({ kind: 'ready' })
    expect(panelReducer(ready, { type: 'CONFERENCE_LEFT', now: DURING }, view())).toBe(ready)
  })

  it('a fatal error offers a retry that will mint a fresh pass', () => {
    const state = panelReducer(inRoom(), { type: 'FATAL_ERROR', now: DURING }, view()).state
    expect(state).toEqual({
      kind: 'token_error',
      reason: 'connection',
      message: PANEL_COPY.connectionLost,
      retryable: true,
    })
    expect(panelReducer(model(state, 1), { type: 'RETRY' }, view()).state).toEqual({ kind: 'requesting' })
  })

  it('a fatal error BEFORE entering the room is a failed connection, not a dropped one', () => {
    // E.g. JaaS refusing the pass (wrong public key / kid): the user never got in.
    const loading = model({ kind: 'loading', join: join(), attempt: 1 }, 1)
    const state = panelReducer(loading, { type: 'FATAL_ERROR', now: DURING }, view()).state
    expect(state).toEqual({
      kind: 'token_error',
      reason: 'connect_failed',
      message: PANEL_COPY.connectFailed,
      retryable: true,
    })
    expect(PANEL_COPY.connectFailed).not.toMatch(/ended/)
    expect(panelReducer(model(state, 1), { type: 'RETRY' }, view()).state).toEqual({ kind: 'requesting' })
  })

  it('an expired pass is explained as such whether or not the user had got in', () => {
    const shortPass = join({ expiresAt: new Date(DURING).toISOString() })
    const loading = model({ kind: 'loading', join: shortPass, attempt: 1 }, 1)
    expect(panelReducer(loading, { type: 'FATAL_ERROR', now: DURING + 1 }, view()).state).toMatchObject({
      reason: 'connection', message: PANEL_COPY.passExpired,
    })
  })

  it('explains an expired pass when the drop happened after expiry', () => {
    const shortPass = join({ expiresAt: new Date(DURING).toISOString() })
    const state = panelReducer(inRoom(shortPass), { type: 'FATAL_ERROR', now: DURING + 1 }, view()).state
    expect(state).toMatchObject({ kind: 'token_error', message: PANEL_COPY.passExpired, retryable: true })
  })

  it('a fatal error after the room closed just ends it', () => {
    expect(panelReducer(inRoom(), { type: 'FATAL_ERROR', now: CLOSES + 1 }, view()).state).toEqual({
      kind: 'ended',
    })
  })

  it('a failed or timed-out script load fails the load, but only while loading', () => {
    const loading = model({ kind: 'loading', join: join(), attempt: 1 }, 1)
    expect(panelReducer(loading, { type: 'LOAD_FAILED' }, view()).state).toEqual({ kind: 'load_failed' })
    expect(panelReducer(inRoom(), { type: 'LOAD_FAILED' }, view())).toEqual(inRoom())
  })
})

describe('clock skew', () => {
  it('computes server minus client', () => {
    expect(clockOffset('2026-10-09T10:00:00.000Z', Date.parse('2026-10-09T09:50:00.000Z'))).toBe(10 * MINUTE)
    expect(clockOffset('2026-10-09T10:00:00.000Z', Date.parse('2026-10-09T10:00:05.000Z'))).toBe(-5_000)
    expect(clockOffset('garbage', Date.now())).toBe(0)
  })

  it('corrects a slow client clock so the room opens on server time', () => {
    const v = view({ serverNow: new Date(OPENS).toISOString() })
    const clientNow = OPENS - 10 * MINUTE // device clock 10 minutes slow
    expect(roomPhaseAt(v, clientNow)).toBe('before')
    expect(roomPhaseAt(v, clientNow + clockOffset(v.serverNow, clientNow))).toBe('open')
  })
})

describe('nextTickDelay', () => {
  it('ticks on the regular interval far from a boundary', () => {
    expect(nextTickDelay(view(), OPENS - 60 * MINUTE)).toBe(PANEL_TICK_MS)
    expect(nextTickDelay(view(), DURING)).toBe(PANEL_TICK_MS)
    expect(nextTickDelay(view(), CLOSES + MINUTE)).toBe(PANEL_TICK_MS)
  })

  it('wakes at the boundary when it is closer than a tick', () => {
    expect(nextTickDelay(view(), OPENS - 5_000)).toBe(5_000)
    // The window is inclusive: 'ended' starts 1 ms after closesAt.
    expect(nextTickDelay(view(), CLOSES - 2_000)).toBe(2_001)
    expect(roomPhaseAt(view(), CLOSES - 2_000 + 2_001)).toBe('ended')
  })

  it('never spins faster than the floor', () => {
    expect(nextTickDelay(view(), OPENS - 3)).toBe(MIN_TICK_MS)
  })
})

describe('roomPassFreshness', () => {
  it('needs no pass for an open self-hosted room', () => {
    expect(roomPassFreshness({ jwt: null, expiresAt: null }, DURING)).toBe('open_room')
  })

  it('is valid strictly before expiry and expired from it', () => {
    const pass = { jwt: 'x', expiresAt: new Date(DURING).toISOString() }
    expect(roomPassFreshness(pass, DURING - 1)).toBe('valid')
    expect(roomPassFreshness(pass, DURING)).toBe('expired')
  })

  it('treats a pass without a readable expiry as spent', () => {
    expect(roomPassFreshness({ jwt: 'x', expiresAt: null }, DURING)).toBe('expired')
    expect(roomPassFreshness({ jwt: 'x', expiresAt: 'soon' }, DURING)).toBe('expired')
  })
})

describe('check-in outcome', () => {
  it('reports success', () => {
    expect(describeCheckIn({ ok: true, message: "You're checked in." })).toEqual({
      tone: 'success',
      message: "You're checked in.",
      window: null,
    })
  })

  it('shows the check-in window when outside it', () => {
    const window = { opensAt: '2026-10-09T09:45:00.000Z', closesAt: '2026-10-09T10:45:00.000Z' }
    expect(
      describeCheckIn({
        ok: false,
        reason: 'outside_window',
        message: 'Check-in for this session has not opened yet.',
        window,
      })
    ).toEqual({ tone: 'notice', message: 'Check-in for this session has not opened yet.', window })
  })

  it('drops an unreadable window rather than rendering Invalid Date', () => {
    expect(
      describeCheckIn({
        ok: false,
        reason: 'outside_window',
        message: 'Closed.',
        window: { opensAt: 'nope', closesAt: '2026-10-09T10:45:00.000Z' },
      }).window
    ).toBeNull()
  })

  it('separates expected notices from errors', () => {
    expect(describeCheckIn({ ok: false, reason: 'code_required', message: 'Use the code.' }).tone).toBe('notice')
    expect(describeCheckIn({ ok: false, reason: 'finalized', message: 'Finalized.' }).tone).toBe('notice')
    expect(describeCheckIn({ ok: false, reason: 'failed', message: 'Failed.' }).tone).toBe('error')
    expect(describeCheckIn({ ok: false, reason: 'not_signed_in', message: 'Sign in.' }).tone).toBe('error')
    expect(describeCheckIn({ ok: false, reason: 'not_available', message: 'No.' }).tone).toBe('error')
  })

  it('never shows a blank outcome', () => {
    expect(describeCheckIn({ ok: false, reason: 'code_required', message: '  ' }).message).toMatch(
      /session code/
    )
    expect(describeCheckIn({ ok: true, message: '' }).message).toMatch(/checked in/)
  })

  it('records the outcome for the rejoin decision', () => {
    expect(checkInDone({ ok: false, reason: 'finalized', message: 'Finalized.' })).toMatchObject({
      kind: 'done',
      ok: false,
      reason: 'finalized',
    })
    expect(checkInDone({ ok: true, message: 'Done.' })).toMatchObject({ kind: 'done', ok: true, reason: null })
  })
})

describe('shouldAttemptCheckIn', () => {
  const done = (state: Parameters<typeof checkInDone>[0]): CheckInState => checkInDone(state)

  it('never checks in an external teacher', () => {
    expect(shouldAttemptCheckIn('external_teacher', { kind: 'idle' })).toBe(false)
  })

  it('never checks in the room host (moderator / accepted teacher)', () => {
    expect(shouldAttemptCheckIn('member', { kind: 'idle' }, { moderator: true })).toBe(false)
    expect(shouldAttemptCheckIn('member', { kind: 'hosting' })).toBe(false)
    expect(shouldAttemptCheckIn('member', { kind: 'idle' }, { moderator: false })).toBe(true)
  })

  it('checks a member in on the first join, not twice at once', () => {
    expect(shouldAttemptCheckIn('member', { kind: 'idle' })).toBe(true)
    expect(shouldAttemptCheckIn('member', { kind: 'pending' })).toBe(false)
  })

  it('does not repeat a settled outcome on rejoin', () => {
    expect(shouldAttemptCheckIn('member', done({ ok: true, message: 'Done.' }))).toBe(false)
    expect(shouldAttemptCheckIn('member', done({ ok: false, reason: 'finalized', message: 'F.' }))).toBe(false)
  })

  it('tries again on rejoin when the window may now be open or the call failed', () => {
    expect(
      shouldAttemptCheckIn('member', done({ ok: false, reason: 'outside_window', message: 'Not yet.' }))
    ).toBe(true)
    expect(shouldAttemptCheckIn('member', done({ ok: false, reason: 'failed', message: 'F.' }))).toBe(true)
    expect(
      shouldAttemptCheckIn('member', { kind: 'done', ok: false, reason: 'failed', display: CHECK_IN_UNREACHABLE })
    ).toBe(true)
  })
})

describe('checkInRetryDelay (joined before check-in opened)', () => {
  const OPEN = Date.parse('2026-10-09T09:45:00.000Z')
  const CLOSE = Date.parse('2026-10-09T10:45:00.000Z')
  const early = checkInDone({
    ok: false,
    reason: 'outside_window',
    message: 'Check-in for this session has not opened yet.',
    window: { opensAt: new Date(OPEN).toISOString(), closesAt: new Date(CLOSE).toISOString() },
  })

  it('waits until the window opens, plus bounded jitter', () => {
    expect(checkInRetryDelay(early, OPEN - 10 * MINUTE)).toBe(10 * MINUTE)
    expect(checkInRetryDelay(early, OPEN - 10 * MINUTE, 1234)).toBe(10 * MINUTE + 1234)
    expect(checkInRetryDelay(early, OPEN - MINUTE, 10 * MINUTE)).toBe(MINUTE + CHECK_IN_RETRY_JITTER_MAX_MS)
    expect(checkInRetryDelay(early, OPEN - MINUTE, -5)).toBe(MINUTE)
  })

  it('does not schedule once the window has opened or closed (no retry loop)', () => {
    expect(checkInRetryDelay(early, OPEN)).toBeNull()
    expect(checkInRetryDelay(early, CLOSE + 1)).toBeNull()
  })

  it('does nothing for any other outcome or an unreadable window', () => {
    expect(checkInRetryDelay({ kind: 'idle' }, OPEN - MINUTE)).toBeNull()
    expect(checkInRetryDelay({ kind: 'hosting' }, OPEN - MINUTE)).toBeNull()
    expect(checkInRetryDelay(checkInDone({ ok: true, message: 'Done.' }), OPEN - MINUTE)).toBeNull()
    expect(checkInRetryDelay(checkInDone({ ok: false, reason: 'code_required', message: 'Code.' }), OPEN - MINUTE)).toBeNull()
    const noWindow = checkInDone({ ok: false, reason: 'outside_window', message: 'Not yet.' })
    expect(checkInRetryDelay(noWindow, OPEN - MINUTE)).toBeNull()
  })
})

describe('canRetryCheckInManually', () => {
  it('offers a manual retry only after a failure', () => {
    expect(canRetryCheckInManually(checkInDone({ ok: false, reason: 'failed', message: 'F.' }))).toBe(true)
    expect(canRetryCheckInManually({ kind: 'done', ok: false, reason: 'failed', display: CHECK_IN_UNREACHABLE })).toBe(true)
    expect(canRetryCheckInManually(checkInDone({ ok: false, reason: 'outside_window', message: 'N.' }))).toBe(false)
    expect(canRetryCheckInManually(checkInDone({ ok: true, message: 'Done.' }))).toBe(false)
    expect(canRetryCheckInManually({ kind: 'idle' })).toBe(false)
  })
})
