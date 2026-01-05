import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isOrgAdmin } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessions } from '@/app/actions/sessions'
import Link from 'next/link'
import { getDepartments } from '@/app/actions/departments'
import { getMyModeratedDepartment } from '@/app/actions/departments'
import { Button } from '@/components/Button'

export default async function DashboardPage() {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    return (
      <div className="min-h-screen">
        <NavShell />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Card>
            <h1 className="text-2xl font-mono font-bold mb-4">Organization Required</h1>
            <p className="font-mono mb-4">Please create or join an organization to continue.</p>
            <Link href="/admin" className="font-mono text-sm underline">
              Go to Admin →
            </Link>
          </Card>
        </div>
      </div>
    )
  }

  const sessions = await getSessions()
  const departments = await getDepartments()
  const moderatedDept = await getMyModeratedDepartment()
  const orgAdmin = await isOrgAdmin()
  const upcomingSessions = sessions
    .filter(s => s.status === 'PUBLISHED' && new Date(s.date_start) > new Date())
    .slice(0, 5)

  // If user is a moderator (not org admin), show simplified view
  if (moderatedDept && !orgAdmin) {
    const departmentSessions = sessions.filter(s => s.department_id === moderatedDept.id)
    const upcomingDeptSessions = departmentSessions
      .filter(s => s.status === 'PUBLISHED' && new Date(s.date_start) > new Date())
      .slice(0, 5)

    return (
      <div className="min-h-screen">
        <NavShell />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2">{moderatedDept.name}</h1>
            <p className="font-mono text-sm text-gray-600">Moderator Dashboard</p>
          </div>

          <div className="mb-6 sm:mb-8">
            <Link href={`/departments/${moderatedDept.id}/sessions/new`}>
              <Button className="w-full sm:w-auto">Create Session</Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Upcoming Sessions</h2>
              {upcomingDeptSessions.length === 0 ? (
                <p className="font-mono text-sm text-gray-600">No upcoming sessions</p>
              ) : (
                <ul className="space-y-2">
                  {upcomingDeptSessions.map(session => (
                    <li key={session.id} className="font-mono text-sm">
                      <Link href={`/sessions/${session.id}`} className="hover:underline">
                        {session.title}
                      </Link>
                      <span className="text-gray-600 ml-2">
                        {new Date(session.date_start).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/departments/${moderatedDept.id}/sessions`} className="mt-4 inline-block font-mono text-sm underline">
                View all sessions →
              </Link>
            </Card>

            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Quick Actions</h2>
              <div className="space-y-3">
                <Link 
                  href={`/departments/${moderatedDept.id}/sessions`}
                  className="block px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50 text-center"
                >
                  Manage Sessions
                </Link>
                <Link 
                  href="/certificates"
                  className="block px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50 text-center"
                >
                  My Certificates
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  // Regular dashboard for org admins and other users
  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Dashboard</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Upcoming Sessions</h2>
            {upcomingSessions.length === 0 ? (
              <p className="font-mono text-sm text-gray-600">No upcoming sessions</p>
            ) : (
              <ul className="space-y-2">
                {upcomingSessions.map(session => (
                  <li key={session.id} className="font-mono text-sm">
                    <Link href={`/sessions/${session.id}`} className="hover:underline">
                      {session.title}
                    </Link>
                    <span className="text-gray-600 ml-2">
                      {new Date(session.date_start).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/departments" className="mt-4 inline-block font-mono text-sm underline">
              View all sessions →
            </Link>
          </Card>

          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Departments</h2>
            {departments.length === 0 ? (
              <p className="font-mono text-sm text-gray-600">No departments yet</p>
            ) : (
              <ul className="space-y-2">
                {departments.map(dept => (
                  <li key={dept.id} className="font-mono text-sm">
                    <Link href={`/departments/${dept.id}/sessions`} className="hover:underline">
                      {dept.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/departments" className="mt-4 inline-block font-mono text-sm underline">
              Manage departments →
            </Link>
          </Card>
        </div>

        <Card>
          <h2 className="text-xl font-mono font-bold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-4">
            <Link 
              href="/admin"
              className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50"
            >
              Admin Panel
            </Link>
            <Link 
              href="/certificates"
              className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50"
            >
              My Certificates
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
