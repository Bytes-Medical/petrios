import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isOrgAdmin } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessionsForOrg, getCalendarSubscriptionUrl } from '@/app/actions/sessions'
import Link from 'next/link'
import { getDepartmentsForOrg, getMyModeratedDepartment } from '@/app/actions/departments'
import { SessionCalendar } from '@/components/SessionCalendar'
import { PersonalDashboard } from '@/components/PersonalDashboard'
import { getMyDepartmentSessions, getMyFeedbackHistory, getMyAttendanceSummary } from '@/app/actions/trainee-dashboard'

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

  const [sessions, departments, moderatedDept, orgAdmin, calendarUrl, mySessions, myFeedback, myAttendance] = await Promise.all([
    getSessionsForOrg(orgId),
    getDepartmentsForOrg(orgId),
    getMyModeratedDepartment(orgId),
    isOrgAdmin(orgId),
    getCalendarSubscriptionUrl(orgId),
    getMyDepartmentSessions(),
    getMyFeedbackHistory(),
    getMyAttendanceSummary(),
  ])

  const isTraineeOnly = !orgAdmin && !moderatedDept

  const primaryCreateHref = moderatedDept
    ? `/departments/${moderatedDept.id}/sessions/new`
    : departments.length === 1
      ? `/departments/${departments[0].id}/sessions/new`
      : '/departments'

  const primaryManageHref = moderatedDept
    ? `/departments/${moderatedDept.id}/sessions`
    : '/departments'

  // Trainee-only view: show just the personal dashboard
  if (isTraineeOnly) {
    return (
      <div className="min-h-screen">
        <NavShell />
        <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2">My Dashboard</h1>
          </div>
          <PersonalDashboard sessions={mySessions} feedback={myFeedback} attendance={myAttendance} />
        </div>
      </div>
    )
  }

  // If user is a moderator (not org admin), show simplified view
  if (moderatedDept && !orgAdmin) {
    const departmentSessions = sessions.filter(s => s.department_id === moderatedDept.id)
    const deptCalendarUrl = await getCalendarSubscriptionUrl(orgId, moderatedDept.id)
    return (
      <div className="min-h-screen">
        <NavShell />
        <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2">{moderatedDept.name}</h1>
            <p className="font-mono text-sm text-gray-600">Moderator Dashboard</p>
          </div>

          <section className="mb-6 sm:mb-8">
            <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl sm:text-2xl font-mono font-bold">Session Calendar</h2>
                <p className="font-mono text-sm text-gray-600">
                  Monthly teaching schedule.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href={primaryCreateHref}
                  className="border border-black bg-black px-4 py-3 text-center font-mono text-sm text-white hover:bg-gray-800"
                >
                  Create Session
                </Link>
                <Link
                  href={primaryManageHref}
                  className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
                >
                  Manage Sessions
                </Link>
              </div>
            </div>
            <SessionCalendar sessions={departmentSessions} subscriptionUrl={deptCalendarUrl} />
          </section>

          <section>
            <h2 className="text-xl sm:text-2xl font-mono font-bold mb-4">My Activity</h2>
            <PersonalDashboard sessions={mySessions} feedback={myFeedback} attendance={myAttendance} />
          </section>
        </div>
      </div>
    )
  }

  // Regular dashboard for org admins and other users
  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Dashboard</h1>

        <section className="mb-6 sm:mb-8">
          <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl sm:text-2xl font-mono font-bold">Session Calendar</h2>
              <p className="font-mono text-sm text-gray-600">
                Full-width monthly calendar so teaching topics stay visible without drilling into each day.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={primaryCreateHref}
                className="border border-black bg-black px-4 py-3 text-center font-mono text-sm text-white hover:bg-gray-800"
              >
                Create Session
              </Link>
              <Link
                href={primaryManageHref}
                className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
              >
                Manage Sessions
              </Link>
            </div>
          </div>
          <SessionCalendar sessions={sessions} subscriptionUrl={calendarUrl} />
        </section>

        <div className="grid grid-cols-1 gap-4 sm:gap-6">
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Departments</h2>
            {departments.length === 0 ? (
              <p className="font-mono text-sm text-gray-600">No departments yet</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {departments.map(dept => (
                  <Link
                    key={dept.id}
                    href={`/departments/${dept.id}/sessions`}
                    className="border border-black bg-white px-4 py-3 font-mono text-sm text-black hover:bg-gray-50"
                  >
                    {dept.name}
                  </Link>
                ))}
              </div>
            )}
            <Link href="/departments" className="mt-4 inline-block font-mono text-sm underline">
              Manage departments →
            </Link>
          </Card>
        </div>

        <section className="mt-6 sm:mt-8">
          <h2 className="text-xl sm:text-2xl font-mono font-bold mb-4">My Activity</h2>
          <PersonalDashboard sessions={mySessions} feedback={myFeedback} attendance={myAttendance} />
        </section>
      </div>
    </div>
  )
}
