import { normaliseEmail, normaliseStaffKey } from './identity-normalise'
import { normaliseRotaCode, ROTA_CODE_PATTERN, type RotaProfileConfig } from './profile'
import { isValidDayKey } from './schema'

/**
 * Reads a parsed CSV through a profile (spec/14). Browser-only in practice:
 * the result still holds names and shift codes, which never leave the device.
 * Only build-payload.ts output is sent.
 *
 * WIDE: one row per person, one column per date (header cells that parse as
 * dates). LONG: one row per duty with date and code columns (and optional
 * start/end times); rows are grouped per person by staff id, else email,
 * else name. Dates outside `range` are ignored, and a person with no coded
 * day inside `range` is left out (counted in `skippedNoDays`). `dates`
 * reports how many dates were recognised (header columns for WIDE, distinct
 * duty dates for LONG) so the wizard can stop early on a wrong date format.
 * A multi-code cell such as `LD/OC` is split on `/`, `+` and `,`.
 */

export interface ExtractedRotaPerson {
  ref: string
  staffKey?: string
  email?: string
  name?: string
  dayCodes: Record<string /*YYYY-MM-DD*/, { code: string; start?: string; end?: string }[]>
}

export interface RotaExtraction {
  people: ExtractedRotaPerson[]
  distinctCodes: { code: string; count: number }[]
  issues: { line: number; field: string; problem: string }[]
  /** Dates read in the profile's format: all of them, those inside the window, and the window's first/last. */
  dates: { recognised: number; inWindow: number; first: string | null; last: string | null }
  /** People in the file with no coded day inside the window (not listed in `people`). */
  skippedNoDays: number
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const MAX_ISSUES = 200

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toKey(y: number, m: number, d: number): string | null {
  const key = `${y}-${pad(m)}-${pad(d)}`
  return isValidDayKey(key) ? key : null
}

/** Parses a date cell or header in the profile's format; a leading weekday word is ignored. */
export function parseRotaDate(raw: string, format: RotaProfileConfig['dateFormat']): string | null {
  const value = raw
    .trim()
    .replace(/^[A-Za-z]{3,9},?\s+/, '')
    .replace(/[T ]\d{1,2}:\d{2}(?::\d{2})?$/, '')
    .trim()
  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
    return m ? toKey(Number(m[1]), Number(m[2]), Number(m[3])) : null
  }
  if (format === 'DD/MM/YYYY') {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value)
    return m ? toKey(Number(m[3]), Number(m[2]), Number(m[1])) : null
  }
  const m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{2}|\d{4})$/.exec(value)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return null
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  return toKey(year, month, Number(m[1]))
}

/** "8:30", "08:30", "0830", "08:30:00" → "08:30"; anything else → null. */
export function parseRotaTime(raw: string): string | null {
  const value = raw.trim()
  const m = /^(\d{1,2}):?(\d{2})(?::\d{2})?$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${pad(h)}:${pad(min)}`
}

export function splitRotaCell(cell: string): string[] {
  return cell
    .split(/[/+,]/)
    .map(normaliseRotaCode)
    .filter((code) => code.length > 0)
}

function columnIndex(header: string[], name: string | undefined): number {
  if (!name) return -1
  const wanted = name.trim().toLowerCase()
  return header.findIndex((cell) => cell.trim().toLowerCase() === wanted)
}

export function extractRotaRows(
  parsed: { header: string[]; rows: string[][] },
  config: RotaProfileConfig,
  range: { from: string; to: string }
): RotaExtraction {
  const issues: RotaExtraction['issues'] = []
  const addIssue = (line: number, field: string, problem: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ line, field, problem })
  }
  const counts = new Map<string, number>()
  const inRange = (key: string | null): key is string => !!key && key >= range.from && key <= range.to

  const { header, rows } = parsed
  const staffCol = columnIndex(header, config.columns.staffId)
  const emailCol = columnIndex(header, config.columns.email)
  const nameCol = columnIndex(header, config.columns.name)
  if (config.columns.staffId && staffCol < 0) addIssue(1, 'staffId', 'column not found')
  if (config.columns.email && emailCol < 0) addIssue(1, 'email', 'column not found')
  if (config.columns.name && nameCol < 0) addIssue(1, 'name', 'column not found')

  const identify = (row: string[], line: number) => {
    const rawStaff = staffCol >= 0 ? (row[staffCol] ?? '').trim() : ''
    const rawEmail = emailCol >= 0 ? (row[emailCol] ?? '').trim() : ''
    const rawName = nameCol >= 0 ? (row[nameCol] ?? '').trim().replace(/\s+/g, ' ') : ''
    const staffKey = rawStaff ? normaliseStaffKey(rawStaff, config.idNormalisation) ?? undefined : undefined
    const email = rawEmail ? normaliseEmail(rawEmail) ?? undefined : undefined
    if (rawStaff && !staffKey) addIssue(line, 'staffId', 'unreadable staff number')
    if (rawEmail && !email) addIssue(line, 'email', 'unreadable email')
    const name = rawName ? rawName.slice(0, 120) : undefined
    return { staffKey, email, name }
  }

  const readCodes = (cell: string, line: number, field: string): string[] => {
    const codes: string[] = []
    for (const code of splitRotaCell(cell)) {
      if (!ROTA_CODE_PATTERN.test(code)) {
        addIssue(line, field, 'unsupported code (longer than 16 characters or unusual characters)')
        continue
      }
      codes.push(code)
    }
    return codes
  }

  const people: ExtractedRotaPerson[] = []
  const recognisedDates = new Set<string>()

  if (config.layout === 'WIDE') {
    const dateCols: { index: number; key: string }[] = []
    header.forEach((cell, index) => {
      if (index === staffCol || index === emailCol || index === nameCol) return
      const key = parseRotaDate(cell, config.dateFormat)
      if (key) recognisedDates.add(key)
      if (inRange(key)) dateCols.push({ index, key })
    })
    rows.forEach((row, rowIndex) => {
      const line = rowIndex + 2
      const id = identify(row, line)
      if (!id.staffKey && !id.email && !id.name) {
        addIssue(line, 'identifier', 'no usable identifier')
        return
      }
      const dayCodes: ExtractedRotaPerson['dayCodes'] = {}
      for (const { index, key } of dateCols) {
        const codes = readCodes(row[index] ?? '', line, 'code')
        if (codes.length === 0) continue
        dayCodes[key] = codes.map((code) => ({ code }))
        for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
      }
      people.push({ ref: `r${rowIndex}`, ...stripUndefined(id), dayCodes })
    })
  } else {
    const dateCol = columnIndex(header, config.columns.date)
    const codeCol = columnIndex(header, config.columns.code)
    const startCol = columnIndex(header, config.columns.start)
    const endCol = columnIndex(header, config.columns.end)
    if (dateCol < 0) addIssue(1, 'date', 'column not found')
    if (codeCol < 0) addIssue(1, 'code', 'column not found')
    if (dateCol >= 0 && codeCol >= 0) {
      const byKey = new Map<string, ExtractedRotaPerson>()
      rows.forEach((row, rowIndex) => {
        const line = rowIndex + 2
        const id = identify(row, line)
        const groupKey = id.staffKey ? `s:${id.staffKey}` : id.email ? `e:${id.email}` : id.name ? `n:${id.name.toLowerCase()}` : null
        if (!groupKey) {
          addIssue(line, 'identifier', 'no usable identifier')
          return
        }
        const rawDate = row[dateCol] ?? ''
        const key = parseRotaDate(rawDate, config.dateFormat)
        if (!key) {
          if (rawDate.trim()) addIssue(line, 'date', 'unreadable date')
          return
        }
        recognisedDates.add(key)
        let person = byKey.get(groupKey)
        if (!person) {
          person = { ref: `r${rowIndex}`, ...stripUndefined(id), dayCodes: {} }
          byKey.set(groupKey, person)
          people.push(person)
        } else {
          // Fill identifiers the first row lacked.
          if (!person.staffKey && id.staffKey) person.staffKey = id.staffKey
          if (!person.email && id.email) person.email = id.email
          if (!person.name && id.name) person.name = id.name
        }
        if (!inRange(key)) return
        const codes = readCodes(row[codeCol] ?? '', line, 'code')
        if (codes.length === 0) return
        const start = startCol >= 0 ? parseRotaTime(row[startCol] ?? '') : null
        const end = endCol >= 0 ? parseRotaTime(row[endCol] ?? '') : null
        if (startCol >= 0 && (row[startCol] ?? '').trim() && !start) addIssue(line, 'start', 'unreadable time')
        if (endCol >= 0 && (row[endCol] ?? '').trim() && !end) addIssue(line, 'end', 'unreadable time')
        const timed = start && end ? { start, end } : {}
        const list = (person.dayCodes[key] ??= [])
        for (const code of codes) {
          list.push({ code, ...timed })
          counts.set(code, (counts.get(code) ?? 0) + 1)
        }
      })
    }
  }

  const distinctCodes = Array.from(counts, ([code, count]) => ({ code, count })).sort(
    (a, b) => b.count - a.count || a.code.localeCompare(b.code)
  )
  const windowDates = [...recognisedDates].filter((key) => inRange(key)).sort()
  const withDays = people.filter((person) => Object.keys(person.dayCodes).length > 0)
  return {
    people: withDays,
    distinctCodes,
    issues,
    dates: {
      recognised: recognisedDates.size,
      inWindow: windowDates.length,
      first: windowDates[0] ?? null,
      last: windowDates[windowDates.length - 1] ?? null,
    },
    skippedNoDays: people.length - withDays.length,
  }
}

function stripUndefined(id: { staffKey?: string; email?: string; name?: string }) {
  const out: { staffKey?: string; email?: string; name?: string } = {}
  if (id.staffKey) out.staffKey = id.staffKey
  if (id.email) out.email = id.email
  if (id.name) out.name = id.name
  return out
}
