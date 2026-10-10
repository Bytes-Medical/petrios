import type { ExtractedRotaPerson } from './mapping'
import { applyPostNightRest, mergeDaySegments } from './post-night'
import type { RotaProfileConfig } from './profile'
import { addDaysToKey, listDayKeys, ROTA_LIMITS, TEMPLATE_ID_ALPHABET, timeToMinutes, UNKNOWN_DAY } from './schema'
import type { RotaSegment } from './types'

/**
 * Code dictionary → day templates (spec/14). Runs in the coordinator's
 * browser: shift codes are turned into status letters here and never sent.
 *
 * - Submit stays blocked while unmappedCodes() is non-empty.
 * - In a multi-code cell any non-A letter wins over A.
 * - IGNORE (and an unmapped code) reads as unknown.
 * - An untimed code fills the whole day; a timed code fills its hours; a
 *   timed shift whose end is not after its start crosses midnight and is split
 *   over the two days.
 * - L and X are always the whole day.
 * - Post-night rest is inferred afterwards (post-night.ts) from the codes that
 *   are nights (isNightCode); explicit codes win on the minutes they cover.
 * - Identical days share one template id ([0-9a-zA-Z], at most 62 per batch).
 */

export class RotaTemplateOverflowError extends Error {
  constructor() {
    super('too many distinct day patterns')
    this.name = 'RotaTemplateOverflowError'
  }
}

/** Shares template ids across every person of one upload. */
export class RotaTemplateRegistry {
  private readonly ids = new Map<string, string>()
  readonly templates: Record<string, RotaSegment[]> = {}

  intern(segments: RotaSegment[]): string {
    if (segments.length === 0) return UNKNOWN_DAY
    const key = JSON.stringify(segments)
    const existing = this.ids.get(key)
    if (existing) return existing
    if (this.ids.size >= ROTA_LIMITS.maxTemplates) throw new RotaTemplateOverflowError()
    const id = TEMPLATE_ID_ALPHABET[this.ids.size]
    this.ids.set(key, id)
    this.templates[id] = segments
    return id
  }
}

export function unmappedCodes(distinct: { code: string; count: number }[], config: RotaProfileConfig): string[] {
  return distinct.map((entry) => entry.code).filter((code) => !Object.prototype.hasOwnProperty.call(config.codes, code))
}

/**
 * Whether a mapped code is a night shift for post-night rest (O4): ticked
 * "Night" in the dictionary (N or D, with times), or a timed N that crosses
 * midnight. An untimed N is a whole rest day, not a night.
 */
export function isNightCode(
  mapped: RotaProfileConfig['codes'][string],
  start: string | undefined,
  end: string | undefined
): boolean {
  if (mapped.letter !== 'N' && mapped.letter !== 'D') return false
  if (mapped.night === true) return true
  return mapped.letter === 'N' && !!start && !!end && timeToMinutes(end) <= timeToMinutes(start)
}

/** Status segments per local day for one person, after post-night rest. */
export function buildPersonDaySegments(
  person: ExtractedRotaPerson,
  config: RotaProfileConfig,
  range: { from: string; to: string }
): Record<string, RotaSegment[]> {
  const days = listDayKeys(range.from, range.to)
  const raw: Record<string, RotaSegment[]> = {}
  for (const day of days) raw[day] = []
  const nightStarts = new Set<string>()
  const nightEnds = new Map<string, number>()

  for (const day of days) {
    for (const entry of person.dayCodes[day] ?? []) {
      if (!Object.prototype.hasOwnProperty.call(config.codes, entry.code)) continue
      const mapped = config.codes[entry.code]
      if (mapped.letter === 'IGNORE') continue
      const letter = mapped.letter
      if (letter === 'L' || letter === 'X') {
        raw[day].push(['00:00', '24:00', letter])
        continue
      }
      const start = entry.start ?? mapped.start
      const end = entry.end ?? mapped.end
      const night = isNightCode(mapped, start, end)
      if (night) nightStarts.add(day)
      if (!start || !end) {
        raw[day].push(['00:00', '24:00', letter])
        continue
      }
      if (timeToMinutes(end) > timeToMinutes(start)) {
        raw[day].push([start, end, letter])
        continue
      }
      // Crosses midnight: evening part today, morning part tomorrow.
      raw[day].push([start, '24:00', letter])
      const next = addDaysToKey(day, 1)
      if (end !== '00:00') {
        if (raw[next]) raw[next].push(['00:00', end, letter])
        if (night) nightEnds.set(next, Math.max(nightEnds.get(next) ?? 0, timeToMinutes(end)))
      }
    }
  }

  const merged: Record<string, RotaSegment[]> = {}
  for (const day of days) merged[day] = mergeDaySegments(raw[day])
  return applyPostNightRest(merged, config.postNight, { nightStarts, nightEnds, explicit: raw })
}

/**
 * One person's `days` string over `range` plus the template table. Pass a
 * shared registry so ids are consistent across the whole upload; without one,
 * ids are local to this person.
 */
export function buildDayTemplates(
  person: ExtractedRotaPerson,
  config: RotaProfileConfig,
  range: { from: string; to: string },
  registry: RotaTemplateRegistry = new RotaTemplateRegistry()
): { days: string; templates: Record<string, RotaSegment[]> } {
  const byDay = buildPersonDaySegments(person, config, range)
  const days = listDayKeys(range.from, range.to)
    .map((day) => registry.intern(byDay[day] ?? []))
    .join('')
  return { days, templates: registry.templates }
}
