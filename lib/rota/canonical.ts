import type { RotaBatchPayload } from './types'

/**
 * Canonical JSON of a rota batch (sorted object keys at every level, array
 * order kept, no whitespace) and its SHA-256. The browser sends the hash with
 * the batch; the server recomputes it and stores it for idempotency, so a
 * replay of the same upload id with different content is refused.
 *
 * WebCrypto only (crypto.subtle): works in the browser, Node 20+ and Workers.
 */

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return 'null'
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`
}

export function canonicalRotaJson(batch: RotaBatchPayload): string {
  return canonicalValue(batch)
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
