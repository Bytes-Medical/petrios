import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isOrgAdmin, isSuperAdmin } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSessionsForOrg, getCalendarSubscriptionUrl } from '@/app/actions/sessions'
import Link from 'next/link'
import { getDepartmentsForOrg, getMyModeratedDepartment } from '@/app/actions/departments'
import { SessionCalendar } from '@/components/SessionCalendar'
import { PersonalDashboard } from '@/components/PersonalDashboard'
import { getMyDepartmentSessions, getMyFeedbackHistory, getMyAttendanceSummary } from '@/app/actions/trainee-dashboard'
import { getMyTeachingAssignments } from '@/app/actions/teaching-assignments'
import { TeachingAssignmentsPanel } from '@/components/TeachingAssignmentsPanel'
import { ensurePersonalWorkspace } from '@/app/actions/personal-workspace'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { tab?: string }
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  if (await isSuperAdmin()) {
    redirect('/super-admin')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    // Individual (non-enterprise) sign-in: auto-provision a personal workspace
    // so the user lands straight on the normal dashboard. Re-render via redirect
    // because getCurrentOrgId() is request-cached and downstream actions call
    // requireOrg(). The "Join a Department" screen below is only the fallback if
    // provisioning fails. (redirect() must stay outside the try/catch — it works
    // by throwing.)
    //
    // Gated by INDIVIDUAL_SIGNUP_ENABLED: in enterprise-only mode we skip this
    // entirely so an org-less user (anyone can request a magic link) cannot
    // self-provision a working account — they fall through to the join wall.
    if (INDIVIDUAL_SIGNUP_ENABLED) {
      let provisioned = false
      try {
        await ensurePersonalWorkspace()
        provisioned = true
      } catch (error) {
        console.error('Personal workspace provisioning failed:', error)
      }
      if (provisioned) {
        redirect('/dashboard')
      }
    }

    return (
      <div className="min-h-screen">
        <NavShell />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <Card>
            <h1 className="text-2xl font-mono font-bold mb-4">Join a Department</h1>
            <p className="font-mono mb-4">
              Enter your 6-digit department code to get started.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/join/dept"
                className="border border-black bg-black px-4 py-3 text-center font-mono text-sm text-white hover:bg-gray-800"
              >
                Join with Department Code
              </Link>
              <Link href="/admin" className="font-mono text-sm underline self-center">
                Admin? Create an organization →
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  const [sessions, departments, moderatedDept, orgAdmin, calendarUrl, mySessions, myFeedback, myAttendance, myTeaching] = await Promise.all([
    getSessionsForOrg(orgId),
    getDepartmentsForOrg(orgId),
    getMyModeratedDepartment(orgId),
    isOrgAdmin(orgId),
    getCalendarSubscriptionUrl(orgId),
    getMyDepartmentSessions(),
    getMyFeedbackHistory(),
    getMyAttendanceSummary(),
    getMyTeachingAssignments(),
  ])

  const pendingTeaching = myTeaching.filter((t) => t.status === 'PENDING')

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
          <PersonalDashboard
            sessions={mySessions}
            feedback={myFeedback}
            attendance={myAttendance}
            teaching={myTeaching}
            orgSessions={sessions}
            calendarUrl={calendarUrl}
            initialTab={searchParams?.tab}
          />
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

          {pendingTeaching.length > 0 && (
            <section className="mb-6 sm:mb-8">
              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Teaching Invitations</h2>
                <TeachingAssignmentsPanel assignments={pendingTeaching} />
              </Card>
            </section>
          )}

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

        {pendingTeaching.length > 0 && (
          <section className="mb-6 sm:mb-8">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Teaching Invitations</h2>
              <TeachingAssignmentsPanel assignments={pendingTeaching} />
            </Card>
          </section>
        )}

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

      </div>
    </div>
  )
}
