import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, getCurrentUserId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { getSession, getSessionTeachers } from '@/app/actions/sessions'
import { getAttendance } from '@/app/actions/attendance'
import { SessionTabs } from '@/components/SessionTabs'
import { Button } from '@/components/Button'
import Link from 'next/link'
import { isDepartmentModerator } from '@/lib/auth'

export default async function SessionPage({
  params,
}: {
  params: { id: string }
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
  const teachers = await getSessionTeachers(params.id)
  const attendance = await getAttendance(params.id)
  const canManage = await isDepartmentModerator(session.department_id)

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link href={`/departments/${session.department_id}/sessions`} className="font-mono text-sm underline mb-3 sm:mb-4 inline-block">
            ← Back to sessions
          </Link>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-3 sm:mt-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold break-words">{session.title}</h1>
              {session.description && (
                <p className="font-mono text-sm text-gray-600 mt-2">{session.description}</p>
              )}
            </div>
            {canManage && (
              <Link href={`/sessions/${params.id}/manage`}>
                <Button variant="secondary">Manage Session</Button>
              </Link>
            )}
          </div>
        </div>

        <SessionTabs
          session={session}
          sessionId={params.id}
          teachers={teachers}
          attendance={attendance}
        />
      </div>
    </div>
  )
}
