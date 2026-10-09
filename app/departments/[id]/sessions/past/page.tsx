import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessions } from '@/app/actions/sessions'
import { getDepartment } from '@/app/actions/departments'
import Link from 'next/link'
import { DepartmentSessionCard } from '@/components/DepartmentSessionCard'

export default async function DepartmentPastSessionsPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const [department, sessions, canManage] = await Promise.all([
    getDepartment(params.id),
    getSessions(params.id, { ended: true }),
    isDepartmentModerator(params.id),
  ])

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-mono font-bold break-words">{department.name}</h1>
            <p className="font-mono text-sm text-gray-600 mt-2">Previous sessions</p>
          </div>
          <Link
            href={`/departments/${params.id}/sessions`}
            className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
          >
            Back to Sessions
          </Link>
        </div>

        {sessions.length === 0 ? (
          <Card>
            <p className="font-mono text-sm">No previous sessions.</p>
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
