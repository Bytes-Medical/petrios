import { z } from 'zod'
import type { RotaBatchPayload } from './types'

/**
 * The minimised rota payload (spec/14, DESIGN §5.1): the ONLY shape the
 * browser may send to submitRotaUpload. Everything is `.strict()`, so an
 * unknown key (a shift code, a name, an extra column) rejects the whole batch.
 *
 * Pure and runtime-neutral: imported by the browser (to build the payload)
 * and by the server (to validate it). Issues name an index and a field and
 * NEVER echo a value from the payload.
 */

export const ROTA_LIMITS = {
  maxPeople: 500,
  maxRangeDays: 98,
  pastDays: 14,
  maxTemplates: 62,
  maxPreviewPerDay: 10,
} as const

export const ROTA_LETTERS = ['A', 'D', 'N', 'X', 'L'] as const
export const TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9]$/
export const TEMPLATE_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** `.` in a days string means "no data" (unknown). */
export const UNKNOWN_DAY = '.'

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const END_TIME_PATTERN = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/
export const REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
/** Already-normalised staff key (normaliseStaffKey output). */
export const STAFF_KEY_PATTERN = /^[A-Z0-9._/-]{1,64}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------- day-key helpers (calendar dates, no time zone involved) ----------

export function isValidDayKey(key: string): boolean {
  if (!DAY_KEY_PATTERN.test(key)) return false
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function dayKeyToUtcMs(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function addDaysToKey(key: string, days: number): string {
  const date = new Date(dayKeyToUtcMs(key) + days * 86_400_000)
  return date.toISOString().slice(0, 10)
}

/** Inclusive day count of [from, to]; 0 when to < from. */
export function rotaDayCount(from: string, to: string): number {
  const diff = Math.round((dayKeyToUtcMs(to) - dayKeyToUtcMs(from)) / 86_400_000)
  return diff < 0 ? 0 : diff + 1
}

/** Every day key in [from, to], in order. */
export function listDayKeys(from: string, to: string): string[] {
  const count = rotaDayCount(from, to)
  const keys: string[] = []
  for (let i = 0; i < count; i++) keys.push(addDaysToKey(from, i))
  return keys
}

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}

// ---------- schemas ----------

export const rotaSegmentSchema = z
  .tuple([z.string().regex(TIME_PATTERN), z.string().regex(END_TIME_PATTERN), z.enum(ROTA_LETTERS)])
  .refine(([start, end]) => timeToMinutes(start) < timeToMinutes(end), { message: 'segment_order' })

const rotaTemplateSchema = z
  .array(rotaSegmentSchema)
  .min(1)
  .max(24)
  .superRefine((segments, ctx) => {
    // Leave and not-working are whole days only, so two kinds of leave can
    // never be told apart by their hours.
    const wholeDay = segments.some(([, , letter]) => letter === 'L' || letter === 'X')
    if (wholeDay) {
      const only = segments.length === 1 && segments[0][0] === '00:00' && segments[0][1] === '24:00'
      if (!only) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'whole_day_letter' })
      return
    }
    for (let i = 1; i < segments.length; i++) {
      if (timeToMinutes(segments[i][0]) < timeToMinutes(segments[i - 1][1])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'segment_overlap' })
        return
      }
    }
  })

export const rotaHeaderSchema = z
  .object({
    v: z.literal(1),
    batch_id: z.string().regex(UUID_PATTERN),
    kind: z.enum(['PLANNED', 'WORKED']),
    range: z
      .object({
        from: z.string().refine(isValidDayKey),
        to: z.string().refine(isValidDayKey),
      })
      .strict(),
    templates: z
      .record(z.string().regex(TEMPLATE_ID_PATTERN), rotaTemplateSchema)
      .refine((t) => Object.keys(t).length <= ROTA_LIMITS.maxTemplates, { message: 'too_many_templates' }),
  })
  .strict()

export const rotaPersonSchema = z
  .object({
    ref: z.string().regex(REF_PATTERN),
    staff_key: z.string().regex(STAFF_KEY_PATTERN).optional(),
    email: z
      .string()
      .max(254)
      .email()
      .refine((v) => v === v.trim().toLowerCase())
      .optional(),
    link: z
      .object({
        user_id: z.string().regex(UUID_PATTERN),
        origin: z.enum(['MODERATOR', 'EMAIL_MATCH']),
      })
      .strict()
      .optional(),
    days: z.string().max(ROTA_LIMITS.maxRangeDays),
  })
  .strict()

export const rotaBatchPayloadSchema = rotaHeaderSchema
  .extend({ people: z.array(rotaPersonSchema).max(ROTA_LIMITS.maxPeople) })
  .strict()

export type RotaValidationIssue = { index: number | null; field: string }

export type RotaBatchValidation =
  | { ok: true; batch: RotaBatchPayload }
  | { ok: false; issues: RotaValidationIssue[] }

const MAX_ISSUES = 50

function issueFromZod(issue: z.ZodIssue): RotaValidationIssue {
  const path = issue.path
  let index: number | null = null
  if (path[0] === 'people' && typeof path[1] === 'number') index = path[1]
  // Field names come from the schema path. An unrecognised key is a CLIENT
  // value, so it is reported generically and never echoed.
  if (issue.code === z.ZodIssueCode.unrecognized_keys) {
    const base = path.filter((p): p is string => typeof p === 'string' && p !== 'people')
    return { index, field: [...base, 'unknown_key'].join('.') }
  }
  const named = path.filter((p): p is string => typeof p === 'string')
  // Inside templates the record key is client data (a template id): drop it.
  const field =
    named[0] === 'templates'
      ? 'templates'
      : named.filter((p) => p !== 'people').join('.') || 'batch'
  return { index, field }
}

/**
 * Strict validation plus the date-window rules that need "today"
 * (`todayKey` is appDayKey() on the server, never the client's clock).
 */
export function validateRotaBatch(
  input: unknown,
  ctx: { todayKey: string; horizonDays: number; callerRole: 'MODERATOR' | 'UPLOADER' }
): RotaBatchValidation {
  const parsed = rotaBatchPayloadSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_ISSUES).map(issueFromZod)
    return { ok: false, issues }
  }
  const batch = parsed.data as RotaBatchPayload
  const issues: RotaValidationIssue[] = []
  const push = (index: number | null, field: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ index, field })
  }

  const { from, to } = batch.range
  const dayCount = rotaDayCount(from, to)
  if (dayCount === 0) push(null, 'range')
  if (dayCount > ROTA_LIMITS.maxRangeDays) push(null, 'range')
  if (from < addDaysToKey(ctx.todayKey, -ROTA_LIMITS.pastDays)) push(null, 'range.from')
  if (to > addDaysToKey(ctx.todayKey, ctx.horizonDays)) push(null, 'range.to')
  if (batch.kind === 'WORKED' && !(to < ctx.todayKey)) push(null, 'kind')
  if (batch.kind === 'PLANNED' && !(from >= ctx.todayKey)) push(null, 'kind')

  const templateIds = new Set(Object.keys(batch.templates))
  const refs = new Set<string>()
  batch.people.forEach((person, index) => {
    if (refs.has(person.ref)) push(index, 'ref')
    refs.add(person.ref)
    if (!person.staff_key && !person.email && !person.link) push(index, 'identifier')
    if (person.link && ctx.callerRole !== 'MODERATOR') push(index, 'link')
    if (person.days.length !== dayCount) {
      push(index, 'days')
      return
    }
    for (const ch of person.days) {
      if (ch !== UNKNOWN_DAY && !templateIds.has(ch)) {
        push(index, 'days')
        return
      }
    }
  })

  return issues.length > 0 ? { ok: false, issues } : { ok: true, batch }
}
