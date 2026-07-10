import { Card } from '@/components/Card'
import { Badge } from '@/components/Badge'
import * as portfolioDb from '@/lib/db/portfolio'

export const dynamic = 'force-dynamic'

interface PackPayload {
  name?: string
  grade?: string | null
  organization?: string | null
  period?: { start: string; end: string }
  attendance?: { session: string; date: string; status: string; source: string | null }[]
  attended?: number
  total?: number
  coverage?: { domain: string; sessions: number }[]
  certificate_codes?: string[]
}

/**
 * PUBLIC verification for portfolio packs (under the public /verify/*
 * prefix). Renders the immutable payload snapshot stored when the pack was
 * generated, so an ARCP panel can confirm a submitted PDF matches what the
 * platform actually recorded.
 */
export default async function VerifyPackPage(props: { params: Promise<{ code: string }> }) {
  const params = await props.params
  const pack = await portfolioDb.findPackByCode(params.code)

  if (!pack) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card variant="raised" className="max-w-md">
          <h1 className="mb-2 font-mono text-xl font-bold">Pack not found</h1>
          <p className="font-mono text-sm text-gray-600">
            No portfolio pack matches this code. Check the code printed in the
            document footer.
          </p>
        </Card>
      </div>
    )
  }

  const payload = pack.payload as PackPayload

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Card variant="raised">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h1 className="font-mono text-2xl font-bold">Portfolio pack verified</h1>
              <p className="mt-1 font-mono text-sm text-gray-600">
                Issued {new Date(pack.created_at).toLocaleDateString('en-GB')} · code{' '}
                {pack.pack_code}
              </p>
            </div>
            <Badge variant="success">Valid</Badge>
          </div>

          <div className="space-y-1 border-b border-gray-200 pb-4 font-mono text-sm">
            <p>
              <strong>Name:</strong> {payload.name ?? '—'}
              {payload.grade ? ` (${payload.grade})` : ''}
            </p>
            <p><strong>Organisation:</strong> {payload.organization ?? '—'}</p>
            <p>
              <strong>Period:</strong> {pack.period_start} to {pack.period_end}
            </p>
            <p>
              <strong>Attendance:</strong> {payload.attended ?? 0} of {payload.total ?? 0}{' '}
              sessions
            </p>
          </div>

          {payload.attendance && payload.attendance.length > 0 && (
            <div className="mt-4">
              <h2 className="mb-2 font-mono text-sm font-bold uppercase tracking-wider">
                Recorded attendance
              </h2>
              <div className="divide-y divide-gray-200 border border-gray-200">
                {payload.attendance.map((entry, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate font-mono text-xs">
                      {entry.session} · {new Date(entry.date).toLocaleDateString('en-GB')}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-gray-600">
                      {entry.status}
                      {entry.source === 'RECALL' ? ' (caught up)' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-4 font-mono text-xs text-gray-500">
            This page renders the snapshot stored when the pack was generated.
            If the PDF you were given differs from this record, treat the PDF
            as altered. Individual certificates can be verified at
            /verify/&lt;certificate-code&gt;.
          </p>
        </Card>
      </div>
    </div>
  )
}
