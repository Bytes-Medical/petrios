/**
 * Deterministic safety rails applied to feedback text before and after it
 * passes through the LLM. Pure functions — unit-tested, no I/O.
 *
 * Anonymisation errs on the side of over-stripping: replacing a non-name
 * ("Emergency Medicine") costs a slightly clumsy quote; leaking a trainee's
 * name into a stored artifact costs trust. Choose the former.
 */

/** Honorific followed by capitalised word(s): "Dr Smith", "Prof. Jane Doe". */
const HONORIFIC_NAME = /\b(?:Dr|Mr|Mrs|Ms|Miss|Prof|Professor|Sister|Nurse)\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g

/** Two adjacent capitalised words mid-text — usually "Firstname Lastname". */
const CAPITALISED_PAIR = /\b[A-Z][a-z]+(?:['-][A-Z][a-z]+)?\s+[A-Z][a-z]+(?:['-][A-Z][a-z]+)?\b/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace name-like tokens with '[name]': all `knownNames` (teachers,
 * attendees — matched case-insensitively as whole words, full names and
 * their individual parts), honorific+name patterns, and the capitalised-pair
 * heuristic.
 */
export function stripNameLikeTokens(text: string, knownNames: string[] = []): string {
  let result = text

  const parts = new Set<string>()
  for (const name of knownNames) {
    const trimmed = name.trim()
    if (!trimmed) continue
    parts.add(trimmed)
    for (const word of trimmed.split(/\s+/)) {
      if (word.length >= 3) parts.add(word)
    }
  }
  // Longest first so "Jane Doe" is replaced before "Jane" splits it.
  const ordered = Array.from(parts).sort((a, b) => b.length - a.length)
  for (const part of ordered) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(part)}\\b`, 'gi'), '[name]')
  }

  result = result.replace(HONORIFIC_NAME, '[name]')
  result = result.replace(CAPITALISED_PAIR, '[name]')

  // Collapse artifacts like "[name] [name]" left by overlapping matches.
  return result.replace(/\[name\](?:\s*\[name\])+/g, '[name]')
}

/**
 * Signals that a comment is about welfare, safety, or conduct rather than
 * teaching quality. Such content must never be summarised into themes — it
 * gets `requires_human_review` and a human reads the raw feedback.
 */
export const WELFARE_PATTERNS: RegExp[] = [
  /bull(?:y|ied|ying|ies)/i,
  /harass/i,
  /discriminat/i,
  /victimis/i,
  /racis/i,
  /sexis/i,
  /\bunsafe\b/i,
  /suicid/i,
  /self[\s-]?harm/i,
  /\babus(?:e|ed|ive)\b/i,
  /safeguarding concern/i,
  /patient safety incident/i,
  /never event/i,
  /whistleblow/i,
  /\bdatix\b/i,
]

export function containsWelfareSignal(text: string): boolean {
  return WELFARE_PATTERNS.some((pattern) => pattern.test(text))
}
