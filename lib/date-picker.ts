/**
 * Pure month-grid helpers for the themed DatePicker. Day keys are
 * 'YYYY-MM-DD' built from LOCAL date parts — never UTC ISO slicing, which
 * would shift days across timezones.
 */

const pad = (n: number) => n.toString().padStart(2, '0')

export function dayKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`
}

export function todayKey(now = new Date()): string {
  return dayKey(now.getFullYear(), now.getMonth(), now.getDate())
}

/**
 * Weeks (Monday-first) for a month; each cell is a 'YYYY-MM-DD' key or null
 * for padding outside the month.
 */
export function buildMonthGrid(
  year: number,
  monthIndex: number
): (string | null)[][] {
  const firstDay = new Date(year, monthIndex, 1)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  // JS getDay(): 0 = Sunday. Shift so 0 = Monday.
  const leading = (firstDay.getDay() + 6) % 7

  const cells: (string | null)[] = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(dayKey(year, monthIndex, day))
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

export function addMonths(
  year: number,
  monthIndex: number,
  delta: number
): { year: number; monthIndex: number } {
  const total = year * 12 + monthIndex + delta
  return { year: Math.floor(total / 12), monthIndex: ((total % 12) + 12) % 12 }
}

export function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

/** 'Wed 9 Jul 2026' for a 'YYYY-MM-DD' key (parsed as local). */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
