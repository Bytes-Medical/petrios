import {
  MAX_SESSION_DURATION_MINS,
  MIN_SESSION_DURATION_MINS,
  computeDateEnd,
  exactDurationFromDates,
  formatDuration,
} from '@/lib/session-duration'
import { dayKeyFromIso, formatDayKey, formatTimeHM, todayKey } from '@/lib/date-picker'
import { normalizeContactEmail } from '@/lib/contacts'
import { generateCode } from '@/lib/codes'
import type { SlotDisplayStatus, SlotStatus } from '@/lib/types'

/**
 * Pure helpers for Calendly-style teaching slots. Datetimes follow the
 * app-wide convention: local combined strings `${dayKey}T${HH:mm}` flow into
 * the DB untouched (same as DateTimePicker + createSession).
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
  today = todayKey()
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
      const dateStart = combineDayAndTime(dayKey, time)
      return { dateStart, dateEnd: computeDateEnd(dateStart, durationMins) }
    })
}

/** Permitted lightning micro-slot lengths, in minutes. */
export const SLOT_SPLIT_OPTIONS = [10, 15, 20] as const

/** Slots at or under this duration render as "Lightning" — one topic,
 *  low stakes, aimed at first-time teachers. */
export const LIGHTNING_SLOT_MAX_MINS = 20

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
export function listSlotTimeOptions(intervalMinutes = 15): string[] {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const options: string[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += intervalMinutes) {
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
 *  claim pages, dashboards, schedule list, and offer emails. */
export function describeSlot(slot: {
  date_start: string
  date_end: string
}): SlotDescription {
  return {
    dateStr: formatDayKey(dayKeyFromIso(slot.date_start)),
    timeRangeStr: `${formatTimeHM(slot.date_start)}–${formatTimeHM(slot.date_end)}`,
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
