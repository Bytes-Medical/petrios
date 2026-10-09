import {
  MAX_SESSION_DURATION_MINS,
  MIN_SESSION_DURATION_MINS,
  computeDateEnd,
  exactDurationFromDates,
  formatDuration,
} from '@/lib/session-duration'
import { appDayKey, appWallClockToIso, formatInAppTimeZone } from '@/lib/datetime'
import { normalizeContactEmail } from '@/lib/contacts'
import { generateCode } from '@/lib/codes'
import type { SlotDisplayStatus, SlotStatus } from '@/lib/types'

/**
 * Pure helpers for Calendly-style teaching slots. Drafts are built on the
 * (UTC) server, so the chosen day + time are read in the app time zone and
 * stored as UTC instants; descriptions are formatted in that same zone.
 */

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function combineDayAndTime(dayKey: string, time: string): string {
  if (!DAY_KEY_RE.test(dayKey)) throw new Error(`Invalid date: ${dayKey}`)
  if (!TIME_RE.test(time)) throw new Error(`Invalid time: ${time}`)
  return `${dayKey}T${time}`
}

export interface SlotDraft {
  dateStart: string
  dateEnd: string
}

/**
 * Turn a multi-select of day keys + batch defaults into slot drafts.
 * Rejects empty selections, past days, and out-of-range durations.
 */
export function buildSlotDrafts(
  dayKeys: string[],
  time: string,
  durationMins: number,
  today = appDayKey()
): SlotDraft[] {
  if (dayKeys.length === 0) {
    throw new Error('Select at least one date')
  }
  if (
    durationMins < MIN_SESSION_DURATION_MINS ||
    durationMins > MAX_SESSION_DURATION_MINS
  ) {
    throw new Error('Duration must be between 30 minutes and 4 hours')
  }

  const past = dayKeys.filter((key) => key < today)
  if (past.length > 0) {
    throw new Error('Slots cannot be created on past dates')
  }

  return Array.from(new Set(dayKeys))
    .sort()
    .map((dayKey) => {
      const dateStart = appWallClockToIso(combineDayAndTime(dayKey, time))
      return { dateStart, dateEnd: computeDateEnd(dateStart, durationMins) }
    })
}

/** Permitted lightning micro-slot lengths, in minutes. */
export const SLOT_SPLIT_OPTIONS = [10, 15, 20] as const

/** Slots at or under this duration render as "Lightning" — one topic,
 *  low stakes, aimed at first-time teachers. */
export const LIGHTNING_SLOT_MAX_MINS = 20
export const SCHEDULING_DAY_START = '08:00'
export const SCHEDULING_DAY_END = '17:30'

/**
 * Split one day's slot range into back-to-back micro-slots. Applied AFTER
 * buildSlotDrafts (whose 30-min-to-4-h validation covers the parent range),
 * so a 60-min range can become 4 × 15-min lightning slots. A trailing
 * remainder shorter than splitMins is dropped.
 */
export function splitSlotDraft(draft: SlotDraft, splitMins: number): SlotDraft[] {
  if (!(SLOT_SPLIT_OPTIONS as readonly number[]).includes(splitMins)) {
    throw new Error(`Split must be one of ${SLOT_SPLIT_OPTIONS.join(', ')} minutes`)
  }
  const rangeMins = exactDurationFromDates(draft.dateStart, draft.dateEnd)
  if (splitMins > rangeMins) {
    throw new Error('Split is longer than the slot range')
  }

  const drafts: SlotDraft[] = []
  let cursor = draft.dateStart
  for (let used = 0; used + splitMins <= rangeMins; used += splitMins) {
    const next = computeDateEnd(cursor, splitMins)
    drafts.push({ dateStart: cursor, dateEnd: next })
    cursor = next
  }
  return drafts
}

/** True for micro-slots that should carry the "Lightning" badge. */
export function isLightningSlot(slot: { date_start: string; date_end: string }): boolean {
  return exactDurationFromDates(slot.date_start, slot.date_end) <= LIGHTNING_SLOT_MAX_MINS
}

/** Time-of-day options ('HH:mm') matching DateTimePicker's format. */
export function listSlotTimeOptions(
  intervalMinutes = 15,
  startTime = SCHEDULING_DAY_START,
  endTime = SCHEDULING_DAY_END
): string[] {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error('Time interval must be a positive whole number')
  }
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    throw new Error('Scheduling times must use HH:mm')
  }

  const toMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number)
    return hours * 60 + minutes
  }
  const startMinutes = toMinutes(startTime)
  const endMinutes = toMinutes(endTime)
  if (endMinutes < startMinutes) {
    throw new Error('Scheduling end time must not be before the start time')
  }

  const pad = (n: number) => n.toString().padStart(2, '0')
  const options: string[] = []
  for (
    let minutes = startMinutes;
    minutes <= endMinutes;
    minutes += intervalMinutes
  ) {
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`)
  }
  return options
}

export interface SlotDescription {
  dateStr: string
  timeRangeStr: string
  durationStr: string
}

/** Human strings for a slot's date, time range, and duration — shared by the
 *  claim pages, dashboards, schedule list, and offer emails. Client panels
 *  pass the server's `appTimeZone()` (they cannot read APP_TIME_ZONE). */
export function describeSlot(
  slot: {
    date_start: string
    date_end: string
  },
  timeZone?: string
): SlotDescription {
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', timeZone }
  return {
    dateStr: formatInAppTimeZone(slot.date_start, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone,
    }),
    timeRangeStr: `${formatInAppTimeZone(slot.date_start, time)}–${formatInAppTimeZone(slot.date_end, time)}`,
    durationStr: formatDuration(exactDurationFromDates(slot.date_start, slot.date_end)),
  }
}

/**
 * Display status: an OPEN slot whose start time has passed is EXPIRED —
 * derived only, never written (the claim guard makes it unclaimable).
 */
export function slotDisplayStatus(
  slot: { status: SlotStatus; date_start: string },
  now: Date = new Date()
): SlotDisplayStatus {
  if (slot.status === 'OPEN' && new Date(slot.date_start) <= now) {
    return 'EXPIRED'
  }
  return slot.status
}

export type ClaimPrecheck = 'CLAIMABLE' | 'ALREADY_YOURS' | 'UNAVAILABLE'

/**
 * Why a slot can or cannot be claimed, checked before the compare-and-set so
 * an expired slot or the caller's own earlier claim (whose response was lost)
 * is not reported as "claimed by someone else".
 */
export function claimPrecheck(
  slot: {
    status: SlotStatus
    date_start: string
    claimed_by_user_id: string | null
    claimed_by_contact_id: string | null
  },
  claimer: { userId?: string; contactId?: string },
  now: Date = new Date()
): ClaimPrecheck {
  if (
    slot.status === 'CLAIMED' &&
    ((claimer.userId && slot.claimed_by_user_id === claimer.userId) ||
      (claimer.contactId && slot.claimed_by_contact_id === claimer.contactId))
  ) {
    return 'ALREADY_YOURS'
  }
  if (slot.status !== 'OPEN' || new Date(slot.date_start) <= now) return 'UNAVAILABLE'
  return 'CLAIMABLE'
}

export interface MemberRecipient {
  userId: string
  email: string
}

export interface ContactRecipient {
  contactId: string
  email: string
}

/**
 * Dedupe publication recipients by email (case-insensitive). A contact whose
 * email belongs to a registered member is dropped — the member gets the
 * in-app claim path instead of a public token.
 */
export function dedupeSlotRecipients(
  members: MemberRecipient[],
  contacts: ContactRecipient[]
): { members: MemberRecipient[]; contacts: ContactRecipient[] } {
  const seen = new Set<string>()
  const dedupedMembers: MemberRecipient[] = []
  for (const member of members) {
    const key = normalizeContactEmail(member.email)
    if (!key || seen.has(key)) continue
    seen.add(key)
    dedupedMembers.push(member)
  }

  const dedupedContacts: ContactRecipient[] = []
  for (const contact of contacts) {
    const key = normalizeContactEmail(contact.email)
    if (!key || seen.has(key)) continue
    seen.add(key)
    dedupedContacts.push(contact)
  }

  return { members: dedupedMembers, contacts: dedupedContacts }
}

export const CLAIM_CODE_LENGTH = 12

/** Capability token for public claim links (longer than session-scoped RSVP
 *  codes because /claim/[code] has no other scoping). */
export function generateClaimCode(random: () => number = Math.random): string {
  return generateCode(CLAIM_CODE_LENGTH, random)
}
