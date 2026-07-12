import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, isOrgManager } from '@/lib/auth'
import { getOpsOverview } from '@/app/actions/ops'
import { NavShell } from '@/components/NavShell'
import { PendingActionsPanel } from '@/components/ops/PendingActionsPanel'
import { RecentRunsPanel } from '@/components/ops/RecentRunsPanel'

export const dynamic = 'force-dynamic'

/**
 * Petrios Ops hub: the human control room for the agent layer. Organisers
 * review drafted outbound actions, audit what the agent did, and reach the
 * assistant, newsletter archive, and curriculum coverage.
 */
export default async function OpsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!(await isOrgManager())) redirect('/dashboard')

  const overview = await getOpsOverview()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="mb-2 font-mono text-2xl font-bold sm:text-3xl">Petrios Ops</h1>
            <p className="font-mono text-sm text-gray-600">
              Your teaching programme&apos;s assistant — it drafts, you decide.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/ops/assistant"
              className="border border-black bg-black px-4 py-3 text-center font-mono text-sm text-white hover:bg-gray-800"
            >
              Open Assistant
            </Link>
            <Link
              href="/ops/newsletters"
              className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
            >
              Newsletters
            </Link>
            <Link
              href="/ops/curriculum"
              className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
            >
              Curriculum
            </Link>
          </div>
        </div>

        {!overview.enabled && (
          <p className="mb-6 border border-amber-600 bg-amber-50 px-4 py-3 font-mono text-sm text-amber-800">
            Petrios Ops is currently disabled (OPS_ENABLED=false). Scheduled jobs,
            the assistant, and approvals are paused; nothing will run or send.
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
          <PendingActionsPanel pending={overview.pending} reviewed={overview.reviewed} />
          <RecentRunsPanel runs={overview.runs} />
        </div>
      </div>
    </div>
  )
}
