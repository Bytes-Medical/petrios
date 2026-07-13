import { describe, expect, it } from 'vitest'
import {
  CLAIM_CODE_LENGTH,
  buildSlotDrafts,
  combineDayAndTime,
  dedupeSlotRecipients,
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
    expect(drafts[0].dateStart).toBe('2026-08-04T13:00')
    expect(new Date(drafts[0].dateEnd).getTime()).toBe(
      new Date('2026-08-04T13:00').getTime() + 90 * 60 * 1000
    )
    expect(drafts[1].dateStart).toBe('2026-08-11T13:00')
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
  it('covers the day at the interval', () => {
    const options = listSlotTimeOptions(15)
    expect(options).toHaveLength(96)
    expect(options[0]).toBe('00:00')
    expect(options[95]).toBe('23:45')
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
