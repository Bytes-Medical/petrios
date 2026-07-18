export const MAX_TEACHING_COORDINATORS = 4
export const MAX_COORDINATOR_NAME_LENGTH = 80

/**
 * Defensive normalization for coordinator settings and stored snapshots.
 * Ordering is meaningful and the first spelling wins when names repeat.
 */
export function normalizeTeachingCoordinatorNames(input: unknown): string[] {
  if (!Array.isArray(input)) return []

  const seen = new Set<string>()
  const names: string[] = []

  for (const value of input) {
    if (typeof value !== 'string') continue
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name) continue

    const key = name.toLocaleLowerCase('en-GB')
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }

  return names
}
/** Server-action boundary for user-supplied department certificate settings. */
export function validateTeachingCoordinatorNames(input: unknown): string[] {
  if (!Array.isArray(input)) {
    throw new Error('Teaching coordinators must be supplied as a list.')
  }
  if (input.length > MAX_TEACHING_COORDINATORS) {
    throw new Error(`Add no more than ${MAX_TEACHING_COORDINATORS} teaching coordinators.`)
  }
  if (input.some((value) => typeof value !== 'string')) {
    throw new Error('Each teaching coordinator must have a text name.')
  }

  const names = normalizeTeachingCoordinatorNames(input)
  if (names.length > MAX_TEACHING_COORDINATORS) {
    throw new Error(`Add no more than ${MAX_TEACHING_COORDINATORS} teaching coordinators.`)
  }
  if (names.some((name) => name.length > MAX_COORDINATOR_NAME_LENGTH)) {
    throw new Error(
      `Teaching coordinator names are limited to ${MAX_COORDINATOR_NAME_LENGTH} characters.`
    )
  }

  return names
}

/** Reads the new list first and falls back to the historical single lead. */
export function resolveTeachingCoordinatorNames(
  coordinatorNames: unknown,
  legacyLeadName?: string | null
): string[] {
  const names = normalizeTeachingCoordinatorNames(coordinatorNames).slice(
    0,
    MAX_TEACHING_COORDINATORS
  )
  if (names.length > 0) return names
  return normalizeTeachingCoordinatorNames([legacyLeadName]).slice(0, 1)
}
