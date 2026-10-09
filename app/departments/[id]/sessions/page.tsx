import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessions } from '@/app/actions/sessions'
import { getDepartment } from '@/app/actions/departments'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { DepartmentSessionCard } from '@/components/DepartmentSessionCard'

export default async function DepartmentSessionsPage(
  props: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ created?: string }>
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams
  const user = await getCurrentUser()
  const createdCount = Number(searchParams.created)

  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const [department, sessions, canManage] = await Promise.all([
    getDepartment(params.id),
    getSessions(params.id, { ended: false }),
    isDepartmentModerator(params.id),
  ])

  const pastHref = `/departments/${params.id}/sessions/past`

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-mono font-bold break-words">{department.name}</h1>
            <p className="font-mono text-sm text-gray-600 mt-2">Sessions</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            {canManage && (
              <>
                <Link href={`/departments/${params.id}/sessions/new`} className="w-full sm:w-auto">
                  <Button className="w-full sm:w-auto">Create Session</Button>
                </Link>
                <Link href={`/departments/${params.id}/schedule`} className="w-full sm:w-auto">
                  <Button variant="secondary" className="w-full sm:w-auto">
                    Schedule Slots
                  </Button>
                </Link>
              </>
            )}
            <Link href={pastHref} className="w-full sm:w-auto">
              <Button variant="secondary" className="w-full sm:w-auto">
                Previous Sessions
              </Button>
            </Link>
          </div>
        </div>

        {Number.isInteger(createdCount) && createdCount > 0 ? (
          <div className="mb-4 border border-green-800 bg-green-50 p-4">
            <p className="font-mono text-sm text-green-900">
              {createdCount} draft session{createdCount === 1 ? '' : 's'} created.
            </p>
            <p className="font-mono text-xs text-green-900 mt-1">
              Sessions whose end time has already passed are listed under{' '}
              <Link href={pastHref} className="underline">
                Previous Sessions
              </Link>
              .
            </p>
          </div>
        ) : null}

        {sessions.length === 0 ? (
          <Card>
            <p className="font-mono text-sm">No upcoming sessions.</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {sessions.map(session => (
              <DepartmentSessionCard key={session.id} session={session} canManage={canManage} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
