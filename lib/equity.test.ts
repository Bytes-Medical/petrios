import { describe, expect, it } from 'vitest'
import { buildEquityReport, equityGapPct, equityReportToCsv } from './equity'

const row = (grade: string | null, attended: number, total: number) => ({
  grade,
  sessions_attended: attended,
  sessions_total: total,
})

describe('buildEquityReport', () => {
  it('aggregates attendance by grade, worst first', () => {
    const report = buildEquityReport([
      row('Level 1 Trainee', 8, 10),
      row('Level 1 Trainee', 6, 10),
      row('Level 2 Trainee', 2, 10),
    ])
    expect(report[0].grade).toBe('Level 2 Trainee')
    expect(report[0].attendancePct).toBe(20)
    expect(report[1]).toMatchObject({ grade: 'Level 1 Trainee', members: 2, attendancePct: 70 })
  })

  it('groups null grades as Unspecified and flags small cohorts', () => {
    const report = buildEquityReport([row(null, 1, 2)])
    expect(report[0].grade).toBe('Unspecified')
    expect(report[0].smallCohort).toBe(true)
  })

  it('handles zero possible sessions without dividing by zero', () => {
    expect(buildEquityReport([row('Consultant', 0, 0)])[0].attendancePct).toBe(0)
  })
})

describe('equityGapPct', () => {
  it('is the spread between best and worst cohorts with data', () => {
    const report = buildEquityReport([
      row('Level 1 Trainee', 9, 10),
      row('Level 2 Trainee', 3, 10),
    ])
    expect(equityGapPct(report)).toBe(60)
  })

  it('is 0 with fewer than two cohorts', () => {
    expect(equityGapPct(buildEquityReport([row('Consultant', 5, 10)]))).toBe(0)
  })
})

describe('equityReportToCsv', () => {
  it('emits a header plus one line per group', () => {
    const csv = equityReportToCsv(buildEquityReport([row('Consultant', 5, 10)]))
    const lines = csv.split('\n')
    expect(lines[0]).toContain('grade,members')
    expect(lines[1]).toContain('"Consultant",1,5,10,50,true')
  })
})
