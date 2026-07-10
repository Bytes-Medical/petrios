'use client'

import { buildEquityReport, equityGapPct, equityReportToCsv } from '@/lib/equity'
import type { AuditMemberRow } from '@/app/actions/audit'
import { Badge } from './Badge'
import { Button } from './Button'
import { cn } from '@/lib/utils'

interface EquityPanelProps {
  members: AuditMemberRow[]
}

/**
 * Attendance equity by grade: surfaces cohorts your teaching schedule is
 * systematically excluding (the thing GMC survey scores punish). Data the
 * audit page already loads — this is just an honest cut of it.
 */
export function EquityPanel({ members }: EquityPanelProps) {
  const report = buildEquityReport(members)
  const gap = equityGapPct(report)

  function downloadCsv() {
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(equityReportToCsv(report))}`
    link.download = 'attendance-equity.csv'
    link.click()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm text-gray-600">
          Attendance rate by grade across your departments&apos; published
          sessions. A large gap suggests scheduling that excludes a cohort
          (rota patterns, timing).
        </p>
        <Button size="sm" variant="secondary" onClick={downloadCsv}>
          Export CSV
        </Button>
      </div>

      {gap >= 25 && (
        <p className="mb-4 border border-amber-600 bg-amber-50 px-3 py-2 font-mono text-xs text-amber-800">
          {gap} percentage points separate your best- and worst-attending
          cohorts — worth reviewing session timings against rota patterns.
        </p>
      )}

      <div className="divide-y divide-gray-200 border border-gray-200">
        {report.map((group) => (
          <div key={group.grade} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="font-mono text-sm font-bold">{group.grade}</p>
              <p className="font-mono text-xs text-gray-500">
                {group.members} member(s) · {group.attended}/{group.possible} attendances
                {group.smallCohort && ' · small cohort, interpret with care'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="hidden h-2 w-32 border border-black sm:block">
                <div
                  className={cn('h-full', group.attendancePct < 50 ? 'bg-red-600' : 'bg-clay-600')}
                  style={{ width: `${Math.min(group.attendancePct, 100)}%` }}
                />
              </div>
              <Badge variant={group.attendancePct < 50 ? 'danger' : 'success'}>
                {group.attendancePct}%
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
