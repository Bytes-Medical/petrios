import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, isOrgManager } from '@/lib/auth'
import { getCurriculumOverview } from '@/app/actions/ops'
import { NavShell } from '@/components/NavShell'
import { Badge } from '@/components/Badge'
import { Card } from '@/components/Card'
import { EnrichSessionForm } from '@/components/ops/EnrichSessionForm'
import { cn } from '@/lib/utils'
import type { OpsMapConfidence } from '@/lib/types'

export const dynamic = 'force-dynamic'

const CONFIDENCE_LABELS: Record<OpsMapConfidence, string> = {
  deterministic: 'Keyword',
  llm_high: 'AI · high',
  llm_low: 'AI · low',
}

const CONFIDENCE_VARIANT: Record<OpsMapConfidence, 'success' | 'default' | 'warning'> = {
  deterministic: 'success',
  llm_high: 'default',
  llm_low: 'warning',
}

export default async function OpsCurriculumPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!(await isOrgManager())) redirect('/dashboard')

  const overview = await getCurriculumOverview()
  const sessionTitles = new Map(overview.sessions.map((s) => [s.id, s.title]))
  const domainNames = new Map(overview.domains.map((d) => [d.code, d.name]))
  const mappedSessionIds = Array.from(new Set(overview.mappings.map((m) => m.session_id)))

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <Link href="/ops" className="font-mono text-sm underline underline-offset-2">
            ← Bytes Ops
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold sm:text-3xl">Curriculum coverage</h1>
          <p className="font-mono text-sm text-gray-600">
            Published sessions from the last 120 days mapped against the RCPCH
            Progress+ domains. The domain list is editable reference data —
            check it against the official curriculum.
          </p>
        </div>

        <div className="space-y-4 sm:space-y-6">
          <Card>
            <h2 className="mb-4 font-mono text-xl font-bold">Coverage this term</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-sm">
                <thead>
                  <tr className="border-b-2 border-black text-left">
                    <th className="py-2 pr-4">Domain</th>
                    <th className="py-2 text-right">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.coverage.map((row) => (
                    <tr
                      key={row.code}
                      className={cn(
                        'border-b border-gray-200',
                        row.sessionCount === 0 && 'bg-red-50'
                      )}
                    >
                      <td className="py-2 pr-4">
                        {row.name}
                        {row.sessionCount === 0 && (
                          <span className="ml-2 font-bold text-red-700">— no coverage</span>
                        )}
                      </td>
                      <td className="py-2 text-right font-bold">{row.sessionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-xs text-gray-500">
              Based on {overview.sessions.length} published session(s) this term,{' '}
              {mappedSessionIds.length} mapped so far. The weekly job maps new
              sessions automatically; use the form below for instant mapping.
            </p>
          </Card>

          <Card>
            <h2 className="mb-1 font-mono text-xl font-bold">Enrich a session</h2>
            <p className="mb-4 font-mono text-sm text-gray-600">
              Generates a short AI summary and stores the domain mapping.
            </p>
            <EnrichSessionForm sessions={overview.sessions} mappedSessionIds={mappedSessionIds} />
          </Card>

          <Card>
            <h2 className="mb-4 font-mono text-xl font-bold">Session mappings</h2>
            {overview.mappings.length === 0 ? (
              <p className="font-mono text-sm text-gray-600">Nothing mapped yet.</p>
            ) : (
              <div className="divide-y divide-gray-200 border border-gray-200">
                {mappedSessionIds.map((sessionId) => (
                  <div key={sessionId} className="px-3 py-2">
                    <p className="font-mono text-sm font-bold">
                      {sessionTitles.get(sessionId) ?? 'Unknown session'}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {overview.mappings
                        .filter((m) => m.session_id === sessionId)
                        .map((m) => (
                          <span key={m.id} className="inline-flex items-center gap-1.5">
                            <span className="font-mono text-xs">
                              {domainNames.get(m.domain_code) ?? m.domain_code}
                            </span>
                            <Badge variant={CONFIDENCE_VARIANT[m.confidence]}>
                              {CONFIDENCE_LABELS[m.confidence]}
                            </Badge>
                          </span>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
