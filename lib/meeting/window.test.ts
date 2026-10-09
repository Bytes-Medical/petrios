import { describe, expect, it } from 'vitest'
import { meetingRoomPhase, meetingRoomWindow, ROOM_CLOSE_MINS_AFTER, ROOM_OPEN_MINS_BEFORE } from './window'

const session = { date_start: '2026-10-09T12:00:00.000Z', date_end: '2026-10-09T13:00:00.000Z' }
const OPENS = new Date('2026-10-09T11:30:00.000Z').getTime()
const CLOSES = new Date('2026-10-09T13:30:00.000Z').getTime()

describe('meetingRoomWindow', () => {
  it('opens 30 minutes before the start and closes 30 minutes after the end', () => {
    expect(ROOM_OPEN_MINS_BEFORE).toBe(30)
    expect(ROOM_CLOSE_MINS_AFTER).toBe(30)
    const { opensAt, closesAt } = meetingRoomWindow(session)
    expect(opensAt.getTime()).toBe(OPENS)
    expect(closesAt.getTime()).toBe(CLOSES)
  })

  it('is timezone-independent (offset timestamps resolve to the same instants)', () => {
    const { opensAt } = meetingRoomWindow({ date_start: '2026-10-09T13:00:00+01:00', date_end: '2026-10-09T14:00:00+01:00' })
    expect(opensAt.getTime()).toBe(OPENS)
  })
})

describe('meetingRoomPhase', () => {
  it.each([
    [OPENS - 1, 'before'],
    [OPENS, 'open'],
    [OPENS + 1, 'open'],
    [new Date(session.date_start).getTime(), 'open'],
    [CLOSES - 1, 'open'],
    [CLOSES, 'open'],
    [CLOSES + 1, 'ended'],
  ] as const)('at %d is %s (inclusive at both ends)', (at, phase) => {
    expect(meetingRoomPhase(session, new Date(at))).toBe(phase)
  })

  it('fails closed on unparseable dates', () => {
    expect(meetingRoomPhase({ date_start: 'nope', date_end: 'nope' }, new Date(OPENS))).toBe('ended')
    expect(meetingRoomPhase(session, new Date('nope'))).toBe('ended')
  })
})
