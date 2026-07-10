import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessions } from '@/app/actions/sessions'
import { getDepartment } from '@/app/actions/departments'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { DeleteSessionButton } from '@/components/DeleteSessionButton'

export default async function DepartmentSessionsPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const department = await getDepartment(params.id)
  const sessions = await getSessions(params.id)
  const canManage = await isDepartmentModerator(params.id)

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-mono font-bold break-words">{department.name}</h1>
            <p className="font-mono text-sm text-gray-600 mt-2">Sessions</p>
          </div>
          {canManage && (
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href={`/departments/${params.id}/sessions/new`} className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto">Create Session</Button>
              </Link>
              <Link href={`/departments/${params.id}/schedule`} className="w-full sm:w-auto">
                <Button variant="secondary" className="w-full sm:w-auto">
                  Schedule Slots
                </Button>
              </Link>
            </div>
          )}
        </div>

        {sessions.length === 0 ? (
          <Card>
            <p className="font-mono text-sm">No sessions yet.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {sessions.map(session => (
              <Card key={session.id}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-mono font-bold mb-2 break-words">
                      <Link href={`/sessions/${session.id}`} className="hover:underline">
                        {session.title}
                      </Link>
                    </h2>
                    {session.description && (
                      <p className="font-mono text-sm text-gray-600 mb-2 break-words">{session.description}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-sm">
                      <span>
                        {new Date(session.date_start).toLocaleString('en-GB')}
                      </span>
                      <span className="text-gray-600">{session.location_type}</span>
                      <span className={`px-2 py-1 border ${
                        session.status === 'PUBLISHED' ? 'border-black' : 'border-gray-400'
                      }`}>
                        {session.status}
                      </span>
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex flex-shrink-0 gap-2">
                      <Link href={`/sessions/${session.id}/manage`} className="flex-1 sm:flex-none">
                        <Button variant="secondary" className="w-full text-xs sm:text-sm">
                          Manage
                        </Button>
                      </Link>
                      <DeleteSessionButton sessionId={session.id} />
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
