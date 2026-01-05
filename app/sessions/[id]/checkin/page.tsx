import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSession } from '@/app/actions/sessions'
import { checkIn } from '@/app/actions/attendance'
import { CheckInButton } from '@/components/CheckInButton'
import { GroupCodeCheckIn } from '@/components/GroupCodeCheckIn'

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { code?: string; v?: string }
}) {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const session = await getSession(params.id)

  if (!session || session.status !== 'PUBLISHED') {
    redirect(`/sessions/${params.id}`)
  }

  const codeVersion = searchParams.v ? parseInt(searchParams.v) : undefined
  const hasGroupCode = session.group_code_enabled && codeVersion !== undefined && codeVersion > 0

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">{session.title}</h1>
          <p className="font-mono text-sm text-gray-600">Check In</p>
        </div>

        <Card>
          {hasGroupCode ? (
            <div className="space-y-4">
              <p className="font-mono text-sm">Enter the group code to check in:</p>
              <GroupCodeCheckIn
                sessionId={params.id}
                groupCodeVersion={codeVersion}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="font-mono text-sm">Check in to this session:</p>
              <CheckInButton sessionId={params.id} />
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
