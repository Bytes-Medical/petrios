import { z } from 'zod'

/**
 * Saved upload profile (spec/14): how to read one coordinator's export.
 * It holds header NAMES and the code legend only, never person data, so it can
 * be stored (rota_upload_profiles.config) and reused next week in one click.
 *
 * Letters: A available · D on duty elsewhere · N night/rest · X not working ·
 * L leave · IGNORE (read as unknown). O3: there is no category; study leave
 * maps to L (or A) in the dictionary. O4: a normal day shift is A; a clashing
 * on-call or long day is D, set per code.
 */

export const ROTA_CODE_PATTERN = /^[A-Za-z0-9 /+_-]{1,16}$/
const HEADER_NAME = z.string().trim().min(1).max(80)
const HHMM = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)

export const DEFAULT_POST_NIGHT = { enabled: true, trigger: 'ANY', restHours: 46 } as const

export const ROTA_PROFILE_MAX_CODES = 200

const codeEntrySchema = z
  .object({
    letter: z.enum(['A', 'D', 'N', 'X', 'L', 'IGNORE']),
    start: HHMM.optional(),
    end: HHMM.optional(),
    night: z.boolean().optional(),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if ((entry.start === undefined) !== (entry.end === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Give both a start and an end time, or neither.' })
    }
    if ((entry.letter === 'L' || entry.letter === 'X' || entry.letter === 'IGNORE') && entry.start !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Leave, not-working and ignored codes are whole days.' })
    }
    if (entry.night && entry.start === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A night code needs its start and end times.' })
    }
    if (entry.night && entry.letter !== 'N' && entry.letter !== 'D') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A night code maps to N (or D).' })
    }
  })

export const rotaProfileConfigSchema = z
  .object({
    v: z.literal(1),
    layout: z.enum(['WIDE', 'LONG']),
    columns: z
      .object({
        staffId: HEADER_NAME.optional(),
        email: HEADER_NAME.optional(),
        name: HEADER_NAME.optional(),
        date: HEADER_NAME.optional(),
        code: HEADER_NAME.optional(),
        dateColumns: z.literal('AUTO').optional(),
        start: HEADER_NAME.optional(),
        end: HEADER_NAME.optional(),
      })
      .strict(),
    dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY']),
    idNormalisation: z.object({ stripAssignmentSuffix: z.boolean() }).strict(),
    codes: z
      .record(z.string().regex(ROTA_CODE_PATTERN), codeEntrySchema)
      .refine((codes) => Object.keys(codes).length <= ROTA_PROFILE_MAX_CODES, {
        message: `At most ${ROTA_PROFILE_MAX_CODES} codes.`,
      }),
    postNight: z
      .object({
        enabled: z.boolean(),
        trigger: z.enum(['ANY', 'THREE_OR_MORE']),
        restHours: z.literal(46),
      })
      .strict(),
  })
  .strict()
  .superRefine((config, ctx) => {
    const c = config.columns
    if (!c.staffId && !c.email && !c.name) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Choose at least one identifier column.' })
    }
    if (config.layout === 'LONG') {
      if (!c.date || !c.code) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Choose the date and code columns.' })
      }
      if (c.dateColumns) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Date columns apply to the grid layout only.' })
      }
      if ((c.start === undefined) !== (c.end === undefined)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Choose both time columns, or neither.' })
      }
    } else {
      if (c.dateColumns !== 'AUTO') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'The grid layout reads dates from the header.' })
      }
      if (c.date || c.code || c.start || c.end) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['columns'], message: 'Date, code and time columns apply to the list layout only.' })
      }
    }
  })

export type RotaProfileConfig = z.infer<typeof rotaProfileConfigSchema>
export type RotaCodeEntry = RotaProfileConfig['codes'][string]

/** Normalised form of one shift code as read from a cell: trimmed, uppercase, single spaces. */
export function normaliseRotaCode(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase()
}

export function defaultRotaProfileConfig(layout: 'WIDE' | 'LONG' = 'WIDE'): RotaProfileConfig {
  return {
    v: 1,
    layout,
    columns: layout === 'WIDE' ? { dateColumns: 'AUTO' } : {},
    dateFormat: 'DD/MM/YYYY',
    idNormalisation: { stripAssignmentSuffix: false },
    codes: {},
    postNight: { ...DEFAULT_POST_NIGHT },
  }
}
