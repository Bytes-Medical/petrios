import { z } from 'zod'
import { STAFF_KEY_PATTERN } from './schema'

/**
 * Identifier normalisation (spec/14 §identity). Runs in the browser before
 * anything is sent, and the server schema accepts only already-normalised
 * values, so the browser and the server always hash the same string.
 *
 *   staff id  trim, drop inner whitespace, uppercase; optionally strip an ESR
 *             assignment suffix ("12345678-2" → "12345678")
 *   email     trim, lowercase, must be a valid address
 *   name      lowercase, accents and punctuation removed, titles dropped,
 *             tokens sorted ("Smith, Dr Jane" = "jane smith"). Client-side
 *             moderator matching only: names never leave the browser.
 */

const emailSchema = z.string().max(254).email()

export function normaliseStaffKey(v: string, o: { stripAssignmentSuffix: boolean }): string | null {
  let value = v.replace(/\s+/g, '').toUpperCase()
  if (o.stripAssignmentSuffix) {
    const dash = value.indexOf('-')
    if (dash > 0) value = value.slice(0, dash)
  }
  if (!value || !STAFF_KEY_PATTERN.test(value)) return null
  return value
}

export function normaliseEmail(v: string): string | null {
  const value = v.trim().toLowerCase()
  if (!value) return null
  return emailSchema.safeParse(value).success ? value : null
}

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'mx', 'prof', 'professor', 'sir', 'dame'])

export function normaliseName(v: string): string {
  const tokens = v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter((token) => token && !TITLES.has(token))
  return tokens.sort().join(' ')
}
