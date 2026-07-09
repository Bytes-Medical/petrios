import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, isOrgManager } from '@/lib/auth'
import { getNewsletterIssues } from '@/app/actions/ops'
import { NavShell } from '@/components/NavShell'
import { Badge } from '@/components/Badge'
import { Card } from '@/components/Card'
import type { OpsNewsletterStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<OpsNewsletterStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning',
  approved: 'default',
  sent: 'success',
  failed: 'danger',
}

export default async function OpsNewslettersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!(await isOrgManager())) redirect('/dashboard')

  const issues = await getNewsletterIssues()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <Link href="/ops" className="font-mono text-sm underline underline-offset-2">
            ← Bytes Ops
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold sm:text-3xl">Newsletter archive</h1>
          <p className="font-mono text-sm text-gray-600">
            The weekly learning-points digest. Drafts wait in the approval
            queue; sent issues are recorded here with their recipient counts.
          </p>
        </div>

        {issues.length === 0 ? (
          <Card>
            <p className="font-mono text-sm text-gray-600">
              No issues yet — the first draft appears after a week with
              delivered sessions.
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {issues.map((issue) => (
              <Card key={issue.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-mono text-lg font-bold">{issue.subject}</h2>
                    <p className="font-mono text-xs text-gray-500">
                      Week commencing{' '}
                      {new Date(issue.week_start).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {issue.status === 'sent' && ` · sent to ${issue.sent_count} member(s)`}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[issue.status]}>{issue.status}</Badge>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer font-mono text-xs underline underline-offset-2 hover:text-clay-700">
                    View issue
                  </summary>
                  {/* Self-generated HTML: built by buildNewsletterHtml with all
                      dynamic text escaped — no user-authored markup. */}
                  <div
                    className="mt-3 border border-gray-300 bg-gray-50 p-2"
                    dangerouslySetInnerHTML={{ __html: issue.html }}
                  />
                </details>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
