import { redirect } from 'next/navigation'
import { getCurrentUser, isOrgManager } from '@/lib/auth'
import { getNewsletterWorkspace } from '@/app/actions/ops'
import { NavShell } from '@/components/NavShell'
import { NewsletterWorkspace } from '@/components/ops/NewsletterWorkspace'
import { newsletterWeekWindow } from '@/lib/ops/newsletter'

export const dynamic = 'force-dynamic'

export default async function OpsNewslettersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!(await isOrgManager())) redirect('/dashboard')

  const workspace = await getNewsletterWorkspace()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <h1 className="font-mono text-2xl font-bold sm:text-3xl">Weekly teaching newsletter</h1>
          <p className="font-mono text-sm text-gray-600">
            A moderator-triggered, teaching-material-led summary for departmental members.
            Generate it, edit the narrative, then explicitly approve delivery.
          </p>
        </div>
        <NewsletterWorkspace
          departments={workspace.departments}
          issues={workspace.issues}
          defaultWeekStart={newsletterWeekWindow(new Date()).weekStartKey}
        />
      </div>
    </div>
  )
}
