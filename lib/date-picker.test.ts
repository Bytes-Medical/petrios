import { describe, expect, it } from 'vitest'
import {
  addMonths,
  buildMonthGrid,
  dayKey,
  formatDayKey,
  monthLabel,
} from './date-picker'

describe('buildMonthGrid', () => {
  it('produces Monday-first weeks of 7 cells', () => {
    // July 2026 starts on a Wednesday
    const grid = buildMonthGrid(2026, 6)
    for (const week of grid) expect(week).toHaveLength(7)
    expect(grid[0][0]).toBeNull() // Monday
    expect(grid[0][1]).toBeNull() // Tuesday
    expect(grid[0][2]).toBe('2026-07-01') // Wednesday
  })

  it('includes every day of the month exactly once', () => {
    const days = buildMonthGrid(2026, 6).flat().filter(Boolean)
    expect(days).toHaveLength(31)
    expect(days[0]).toBe('2026-07-01')
    expect(days[30]).toBe('2026-07-31')
  })

  it('handles leap-year February', () => {
    const days = buildMonthGrid(2028, 1).flat().filter(Boolean)
    expect(days).toHaveLength(29)
    expect(days[28]).toBe('2028-02-29')
  })

  it('handles a month starting on Monday with no leading padding', () => {
    // June 2026 starts on a Monday
    const grid = buildMonthGrid(2026, 5)
    expect(grid[0][0]).toBe('2026-06-01')
  })
})

describe('addMonths', () => {
  it('moves forward within a year', () => {
    expect(addMonths(2026, 6, 1)).toEqual({ year: 2026, monthIndex: 7 })
  })

  it('rolls over year boundaries in both directions', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 })
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 })
  })
})

describe('formatting', () => {
  it('builds zero-padded day keys', () => {
    expect(dayKey(2026, 0, 5)).toBe('2026-01-05')
  })

  it('formats keys and month labels for en-GB', () => {
    expect(formatDayKey('2026-07-08')).toMatch(/8 Jul 2026/)
    expect(monthLabel(2026, 6)).toBe('July 2026')
  })
})
