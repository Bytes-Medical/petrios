/**
 * PostgREST returns embedded resources as `T | T[]` depending on the
 * relationship cardinality it infers; normalize to a single row or null.
 */
export function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}
