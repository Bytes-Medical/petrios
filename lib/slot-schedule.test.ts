import { describe, expect, it } from 'vitest'
import {
  CLAIM_CODE_LENGTH,
  buildSlotDrafts,
  claimPrecheck,
  combineDayAndTime,
  dedupeSlotRecipients,
  describeSlot,
  generateClaimCode,
  isLightningSlot,
  listSlotTimeOptions,
  slotDisplayStatus,
  splitSlotDraft,
} from './slot-schedule'

describe('combineDayAndTime', () => {
  it('joins into the app-wide local datetime shape', () => {
    expect(combineDayAndTime('2026-08-04', '13:00')).toBe('2026-08-04T13:00')
  })

  it('rejects malformed inputs', () => {
    expect(() => combineDayAndTime('04/08/2026', '13:00')).toThrow('Invalid date')
    expect(() => combineDayAndTime('2026-08-04', '25:00')).toThrow('Invalid time')
    expect(() => combineDayAndTime('2026-08-04', '1pm')).toThrow('Invalid time')
  })
})

describe('buildSlotDrafts', () => {
  const today = '2026-07-09'

  it('builds sorted drafts with computed ends', () => {
    const drafts = buildSlotDrafts(['2026-08-11', '2026-08-04'], '13:00', 90, today)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      dateStart: '2026-08-04T12:00:00.000Z',
      dateEnd: '2026-08-04T13:30:00.000Z',
    })
    expect(drafts[1].dateStart).toBe('2026-08-11T12:00:00.000Z')
  })

  it('reads the chosen time as London wall-clock time on a UTC server', () => {
    const [summer, winter] = buildSlotDrafts(['2026-10-09', '2026-12-01'], '16:15', 60, today)
    expect(summer.dateStart).toBe('2026-10-09T15:15:00.000Z')
    expect(winter.dateStart).toBe('2026-12-01T16:15:00.000Z')
    expect(describeSlot({ date_start: summer.dateStart, date_end: summer.dateEnd })).toEqual({
      dateStr: 'Fri, 9 Oct 2026',
      timeRangeStr: '16:15–17:15',
      durationStr: '1 hour',
    })
  })

  it('describes a slot in an explicit zone handed down from the server', () => {
    expect(
      describeSlot({ date_start: '2026-10-09T15:15:00.000Z', date_end: '2026-10-09T16:15:00.000Z' }, 'America/New_York')
    ).toEqual({
      dateStr: 'Fri, 9 Oct 2026',
      timeRangeStr: '11:15–12:15',
      durationStr: '1 hour',
    })
  })

  it('dedupes repeated day selections', () => {
    expect(buildSlotDrafts(['2026-08-04', '2026-08-04'], '09:00', 60, today)).toHaveLength(1)
  })

  it('rejects empty selections, past dates, and bad durations', () => {
    expect(() => buildSlotDrafts([], '13:00', 60, today)).toThrow('at least one date')
    expect(() => buildSlotDrafts(['2026-07-08'], '13:00', 60, today)).toThrow('past dates')
    expect(() => buildSlotDrafts(['2026-08-04'], '13:00', 15, today)).toThrow('Duration')
    expect(() => buildSlotDrafts(['2026-08-04'], '13:00', 300, today)).toThrow('Duration')
  })

  it('allows today', () => {
    expect(buildSlotDrafts([today], '23:45', 30, today)).toHaveLength(1)
  })
})

describe('splitSlotDraft', () => {
  const draft = (start: string, end: string) => ({ dateStart: start, dateEnd: end })

  it('splits a 60-min range into 4 contiguous 15-min drafts', () => {
    const result = splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T13:00'), 15)
    expect(result).toHaveLength(4)
    expect(result[0].dateStart).toBe('2030-01-10T12:00')
    for (let i = 1; i < result.length; i++) {
      expect(result[i].dateStart).toBe(result[i - 1].dateEnd)
    }
    expect(new Set(result.map((r) => r.dateStart)).size).toBe(4)
    // dateEnd is a full ISO string (computeDateEnd convention) — compare instants
    expect(new Date(result[3].dateEnd).getTime()).toBe(
      new Date('2030-01-10T13:00').getTime()
    )
  })

  it('drops a trailing remainder shorter than the split', () => {
    const result = splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T13:30'), 20)
    expect(result).toHaveLength(4)
    expect(new Date(result[3].dateEnd).getTime()).toBe(
      new Date('2030-01-10T13:20').getTime()
    )
  })

  it('returns a single draft when the range equals the split', () => {
    const result = splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T12:20'), 20)
    expect(result).toHaveLength(1)
  })

  it('rejects split lengths outside SLOT_SPLIT_OPTIONS', () => {
    expect(() => splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T13:00'), 7)).toThrow()
    expect(() => splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T13:00'), 30)).toThrow()
  })

  it('rejects a split longer than the range', () => {
    expect(() =>
      splitSlotDraft(draft('2030-01-10T12:00', '2030-01-10T12:10'), 15)
    ).toThrow('Split is longer than the slot range')
  })
})

describe('isLightningSlot', () => {
  it('is true at or under the lightning maximum', () => {
    expect(isLightningSlot({ date_start: '2030-01-10T12:00', date_end: '2030-01-10T12:15' })).toBe(true)
    expect(isLightningSlot({ date_start: '2030-01-10T12:00', date_end: '2030-01-10T12:20' })).toBe(true)
  })

  it('is false for regular slots', () => {
    expect(isLightningSlot({ date_start: '2030-01-10T12:00', date_end: '2030-01-10T12:30' })).toBe(false)
  })
})

describe('listSlotTimeOptions', () => {
  it('covers the working day at the interval', () => {
    const options = listSlotTimeOptions(15)
    expect(options).toHaveLength(39)
    expect(options[0]).toBe('08:00')
    expect(options[38]).toBe('17:30')
  })

  it('supports an explicit wider range', () => {
    expect(listSlotTimeOptions(30, '07:00', '08:00')).toEqual([
      '07:00',
      '07:30',
      '08:00',
    ])
  })
})

describe('slotDisplayStatus', () => {
  const now = new Date('2026-07-09T12:00:00Z')

  it('marks past OPEN slots as EXPIRED (boundary inclusive)', () => {
    expect(slotDisplayStatus({ status: 'OPEN', date_start: '2026-07-09T11:00:00Z' }, now)).toBe('EXPIRED')
    expect(slotDisplayStatus({ status: 'OPEN', date_start: '2026-07-09T12:00:00Z' }, now)).toBe('EXPIRED')
    expect(slotDisplayStatus({ status: 'OPEN', date_start: '2026-07-09T12:01:00Z' }, now)).toBe('OPEN')
  })

  it('never expires CLAIMED or CLOSED slots', () => {
    expect(slotDisplayStatus({ status: 'CLAIMED', date_start: '2020-01-01T00:00:00Z' }, now)).toBe('CLAIMED')
    expect(slotDisplayStatus({ status: 'CLOSED', date_start: '2020-01-01T00:00:00Z' }, now)).toBe('CLOSED')
  })
})

describe('claimPrecheck', () => {
  const now = new Date('2026-07-09T12:00:00Z')
  const open = {
    status: 'OPEN' as const,
    date_start: '2026-07-10T09:00:00Z',
    claimed_by_user_id: null,
    claimed_by_contact_id: null,
  }

  it('allows a future OPEN slot', () => {
    expect(claimPrecheck(open, { userId: 'u1' }, now)).toBe('CLAIMABLE')
  })

  it('rejects an OPEN slot whose start has passed (boundary inclusive)', () => {
    expect(claimPrecheck({ ...open, date_start: '2026-07-09T12:00:00Z' }, { userId: 'u1' }, now)).toBe('UNAVAILABLE')
  })

  it('recognises the caller\'s own earlier claim by user or contact', () => {
    expect(claimPrecheck({ ...open, status: 'CLAIMED', claimed_by_user_id: 'u1' }, { userId: 'u1' }, now)).toBe('ALREADY_YOURS')
    expect(claimPrecheck({ ...open, status: 'CLAIMED', claimed_by_contact_id: 'c1' }, { contactId: 'c1' }, now)).toBe('ALREADY_YOURS')
  })

  it('treats a slot held by someone else, or closed, as unavailable', () => {
    expect(claimPrecheck({ ...open, status: 'CLAIMED', claimed_by_user_id: 'u2' }, { userId: 'u1' }, now)).toBe('UNAVAILABLE')
    expect(claimPrecheck({ ...open, status: 'CLAIMED', claimed_by_contact_id: 'c2' }, { contactId: 'c1' }, now)).toBe('UNAVAILABLE')
    expect(claimPrecheck({ ...open, status: 'CLOSED' }, { userId: 'u1' }, now)).toBe('UNAVAILABLE')
  })

  it('never matches an absent caller id against an empty claimer column', () => {
    expect(claimPrecheck({ ...open, status: 'CLAIMED', claimed_by_contact_id: 'c1' }, { userId: 'u1' }, now)).toBe('UNAVAILABLE')
  })
})

describe('dedupeSlotRecipients', () => {
  it('dedupes case-insensitively and lets members win over contacts', () => {
    const result = dedupeSlotRecipients(
      [
        { userId: 'u1', email: 'Alice@nhs.net' },
        { userId: 'u2', email: 'alice@nhs.net' },
        { userId: 'u3', email: 'bob@nhs.net' },
      ],
      [
        { contactId: 'c1', email: 'ALICE@nhs.net' },
        { contactId: 'c2', email: 'carol@gmail.com' },
        { contactId: 'c3', email: 'Carol@Gmail.com' },
      ]
    )
    expect(result.members.map((m) => m.userId)).toEqual(['u1', 'u3'])
    expect(result.contacts.map((c) => c.contactId)).toEqual(['c2'])
  })

  it('drops empty emails', () => {
    const result = dedupeSlotRecipients(
      [{ userId: 'u1', email: '  ' }],
      [{ contactId: 'c1', email: '' }]
    )
    expect(result.members).toEqual([])
    expect(result.contacts).toEqual([])
  })
})

describe('generateClaimCode', () => {
  it('produces codes of the documented length and alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateClaimCode()
      expect(code).toHaveLength(CLAIM_CODE_LENGTH)
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/)
    }
  })

  it('is deterministic with an injected RNG', () => {
    expect(generateClaimCode(() => 0)).toBe('A'.repeat(CLAIM_CODE_LENGTH))
  })
})
