import { describe, expect, it } from 'vitest'
import { formatNewsDate, NEWS } from './news-data'

describe('formatNewsDate', () => {
  it('renders an en-GB long date', () => {
    expect(formatNewsDate('2026-07-12')).toBe('12 July 2026')
    expect(formatNewsDate('2026-01-01')).toBe('1 January 2026')
    expect(formatNewsDate('2026-12-31')).toBe('31 December 2026')
  })

  it('formats every published entry', () => {
    for (const entry of NEWS) expect(formatNewsDate(entry.date)).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  })
})
