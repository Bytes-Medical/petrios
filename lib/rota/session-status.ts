import type { RotaLetter } from './types'

/**
 * Session overlap rule (spec/14, DESIGN §5.1), for a session [start, end):
 *   UNAVAILABLE  when D + N + X + L minutes ≥ min(30, 50% of the session)
 *   AVAILABLE    otherwise, when A covers ≥ 50% of the session
 *   UNKNOWN      otherwise (minutes no segment covers are unknown)
 */

export type RotaSessionStatus = 'UNAVAILABLE' | 'AVAILABLE' | 'UNKNOWN'

const UNAVAILABLE_LETTERS: ReadonlySet<RotaLetter> = new Set(['D', 'N', 'X', 'L'])
const MINUTE = 60_000

export function classifySessionOverlap(
  intervals: { startMs: number; endMs: number; letter: RotaLetter }[],
  session: { startMs: number; endMs: number }
): RotaSessionStatus {
  const durationMin = (session.endMs - session.startMs) / MINUTE
  if (!(durationMin > 0)) return 'UNKNOWN'
  let unavailable = 0
  let available = 0
  for (const interval of intervals) {
    const overlap = Math.min(interval.endMs, session.endMs) - Math.max(interval.startMs, session.startMs)
    if (overlap <= 0) continue
    if (UNAVAILABLE_LETTERS.has(interval.letter)) unavailable += overlap / MINUTE
    else if (interval.letter === 'A') available += overlap / MINUTE
  }
  if (unavailable >= Math.min(30, durationMin / 2)) return 'UNAVAILABLE'
  if (available >= durationMin / 2) return 'AVAILABLE'
  return 'UNKNOWN'
}
