/**
 * Attendance equity lens (v1: by trainee grade). Teaching that
 * systematically excludes a cohort — nights rotas, LTFT patterns —
 * shows up as a grade whose attendance rate sits far below the others.
 * Pure aggregation over the audit page's member rows; rota-group tagging
 * is the roadmap upgrade.
 */

export interface EquityInputRow {
  grade: string | null
  sessions_attended: number
  sessions_total: number
}

export interface EquityGroup {
  grade: string
  members: number
  attended: number
  possible: number
  attendancePct: number
  /** Cohorts under this size are statistically fragile — render with care. */
  smallCohort: boolean
}

export const SMALL_COHORT_THRESHOLD = 5

export function buildEquityReport(rows: EquityInputRow[]): EquityGroup[] {
  const groups = new Map<string, { members: number; attended: number; possible: number }>()

  for (const row of rows) {
    const grade = row.grade ?? 'Unspecified'
    const group = groups.get(grade) ?? { members: 0, attended: 0, possible: 0 }
    group.members += 1
    group.attended += row.sessions_attended
    group.possible += row.sessions_total
    groups.set(grade, group)
  }

  return Array.from(groups.entries())
    .map(([grade, g]) => ({
      grade,
      members: g.members,
      attended: g.attended,
      possible: g.possible,
      attendancePct: g.possible > 0 ? Math.round((g.attended / g.possible) * 100) : 0,
      smallCohort: g.members < SMALL_COHORT_THRESHOLD,
    }))
    .sort((a, b) => a.attendancePct - b.attendancePct)
}

/** The gap between the best- and worst-attending (non-empty) cohorts. */
export function equityGapPct(groups: EquityGroup[]): number {
  const withData = groups.filter((g) => g.possible > 0)
  if (withData.length < 2) return 0
  return Math.max(...withData.map((g) => g.attendancePct)) -
    Math.min(...withData.map((g) => g.attendancePct))
}

export function equityReportToCsv(groups: EquityGroup[]): string {
  const header = 'grade,members,sessions_attended,sessions_possible,attendance_pct,small_cohort'
  const lines = groups.map((g) =>
    [JSON.stringify(g.grade), g.members, g.attended, g.possible, g.attendancePct, g.smallCohort].join(',')
  )
  return [header, ...lines].join('\n')
}
