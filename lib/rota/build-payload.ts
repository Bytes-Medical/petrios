import { addDaysToKey, rotaDayCount } from './schema'
import type { RotaBatchPayload, RotaBatchPerson, RotaPersonLink, RotaSegment } from './types'

/**
 * Builds the minimised batches the browser sends (spec/14). One export is
 * split at `todayKey`: days before today become the WORKED (as-worked) batch,
 * today onwards the PLANNED batch. Each person carries ONLY schema keys
 * (ref, staff_key?, email?, link?, days): never a name, a shift code or any
 * other column. Templates are limited to the ids each batch uses.
 */

export interface RotaPayloadPersonInput {
  ref: string
  staffKey?: string
  email?: string
  link?: RotaPersonLink
  days: string
}

function sliceBatch(
  kind: 'WORKED' | 'PLANNED',
  batchId: string,
  people: RotaPayloadPersonInput[],
  templates: Record<string, RotaSegment[]>,
  fullFrom: string,
  from: string,
  to: string
): RotaBatchPayload | null {
  const count = rotaDayCount(from, to)
  if (count === 0) return null
  const offset = rotaDayCount(fullFrom, from) - 1
  const used = new Set<string>()
  const batchPeople: RotaBatchPerson[] = people.map((person) => {
    const days = person.days.slice(offset, offset + count)
    for (const ch of days) used.add(ch)
    const out: RotaBatchPerson = { ref: person.ref, days }
    if (person.staffKey) out.staff_key = person.staffKey
    if (person.email) out.email = person.email
    if (person.link) out.link = { user_id: person.link.user_id, origin: person.link.origin }
    return out
  })
  const batchTemplates: Record<string, RotaSegment[]> = {}
  for (const [id, segments] of Object.entries(templates)) {
    if (used.has(id)) batchTemplates[id] = segments.map(([s, e, l]) => [s, e, l] as RotaSegment)
  }
  return { v: 1, batch_id: batchId, kind, range: { from, to }, templates: batchTemplates, people: batchPeople }
}

export function buildRotaBatches(input: {
  people: RotaPayloadPersonInput[]
  templates: Record<string, RotaSegment[]>
  range: { from: string; to: string }
  todayKey: string
  batchIds: { worked: string; planned: string }
}): { worked: RotaBatchPayload | null; planned: RotaBatchPayload | null } {
  const { range, todayKey } = input
  const yesterday = addDaysToKey(todayKey, -1)
  const workedTo = range.to < yesterday ? range.to : yesterday
  const plannedFrom = range.from > todayKey ? range.from : todayKey
  const worked =
    range.from <= workedTo
      ? sliceBatch('WORKED', input.batchIds.worked, input.people, input.templates, range.from, range.from, workedTo)
      : null
  const planned =
    plannedFrom <= range.to
      ? sliceBatch('PLANNED', input.batchIds.planned, input.people, input.templates, range.from, plannedFrom, range.to)
      : null
  return { worked, planned }
}
