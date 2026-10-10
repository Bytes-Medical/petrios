import { appWallClockToIso } from '@/lib/datetime'
import { expandPersonDays } from './expand'
import { addDaysToKey } from './schema'
import { classifySessionOverlap } from './session-status'
import type { RotaBatchPayload, RotaCandidateSession, RotaFlagKey } from './types'

/**
 * Matched people × candidate sessions → flag writes (spec/14). Pure, server
 * side. Only sessions overlapping the batch's local range are considered.
 * UNAVAILABLE → `flags`; AVAILABLE → `cleared` (the RPC deletes an OPEN flag
 * or marks a decided one "rota changed", subject to precedence). UNKNOWN (a
 * blank day, or hours no code covers) is sent in neither list, so a later
 * upload with a gap never removes a correct flag. `sessionsAnnotated` counts
 * sessions with at least one known (unavailable or available) person. The
 * rota grid itself is never stored: only these keys reach the database.
 */
export function computeRotaIngest(input: {
  batch: RotaBatchPayload
  matched: { userId: string; days: string }[]
  sessions: RotaCandidateSession[]
}): { flags: RotaFlagKey[]; cleared: RotaFlagKey[]; sessionsAnnotated: number } {
  const { batch } = input
  const rangeStart = Date.parse(appWallClockToIso(`${batch.range.from}T00:00`))
  const rangeEnd = Date.parse(appWallClockToIso(`${addDaysToKey(batch.range.to, 1)}T00:00`))
  const sessions = input.sessions
    .map((s) => ({ id: s.id, startMs: Date.parse(s.date_start), endMs: Date.parse(s.date_end) }))
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs > s.startMs)
    .filter((s) => s.startMs < rangeEnd && s.endMs > rangeStart)

  const flags: RotaFlagKey[] = []
  const cleared: RotaFlagKey[] = []
  const annotated = new Set<string>()
  if (sessions.length === 0) return { flags, cleared, sessionsAnnotated: 0 }

  for (const person of input.matched) {
    const intervals = expandPersonDays(person.days, batch.templates, batch.range)
    for (const session of sessions) {
      const status = classifySessionOverlap(intervals, session)
      const key = { session_id: session.id, user_id: person.userId }
      if (status === 'UNKNOWN') continue
      if (status === 'UNAVAILABLE') flags.push(key)
      else cleared.push(key)
      annotated.add(session.id)
    }
  }
  return { flags, cleared, sessionsAnnotated: annotated.size }
}
