import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentUser, isOrgManager } from '@/lib/auth'
import { listChatThreads } from '@/app/actions/ops-chat'
import { opsAssistantEnabled } from '@/lib/ops/flags'
import { NavShell } from '@/components/NavShell'
import { OpsChatPanel } from '@/components/ops/OpsChatPanel'

export const dynamic = 'force-dynamic'

export default async function OpsAssistantPage() {
  if (!opsAssistantEnabled()) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (!(await isOrgManager())) redirect('/dashboard')

  const threads = await listChatThreads()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-8 sm:py-8">
        <div className="mb-6">
          <Link href="/ops" className="font-mono text-sm underline underline-offset-2">
            ← Petrios Ops
          </Link>
          <h1 className="mt-2 font-mono text-2xl font-bold sm:text-3xl">Assistant</h1>
          <p className="font-mono text-sm text-gray-600">
            Knows your programme&apos;s sessions, feedback, and the platform.
            Drafts go to the approval queue — it never sends anything itself.
          </p>
        </div>

        <OpsChatPanel threads={threads} />
      </div>
    </div>
  )
}
