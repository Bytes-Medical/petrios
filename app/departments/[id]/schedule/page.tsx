import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, requireDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { ScheduleManagerPanel } from '@/components/ScheduleManagerPanel'
import { SessionCalendar } from '@/components/SessionCalendar'
import { getDepartmentSlots, getPublishAudienceMeta } from '@/app/actions/teaching-slots'
import { getSessionsForOrg, getCalendarSubscriptionUrl } from '@/app/actions/sessions'
import { getDepartmentsForOrg } from '@/app/actions/departments'
import { dayKeyFromIso } from '@/lib/date-picker'

export const dynamic = 'force-dynamic'

export default async function DepartmentSchedulePage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/dashboard')

  try {
    await requireDepartmentModerator(params.id)
  } catch {
    redirect('/dashboard')
  }

  const [slots, audienceMeta, sessions, departments, calendarUrl] = await Promise.all([
    getDepartmentSlots(params.id),
    getPublishAudienceMeta(params.id),
    getSessionsForOrg(orgId),
    getDepartmentsForOrg(orgId),
    getCalendarSubscriptionUrl(orgId, params.id),
  ])

  const department = departments.find((d) => d.id === params.id)
  const departmentSessions = sessions.filter((s) => s.department_id === params.id)

  const busyDayKeys = Array.from(
    new Set([
      ...departmentSessions.map((s) => dayKeyFromIso(s.date_start)),
      ...slots
        .filter((s) => s.status === 'OPEN' || s.status === 'CLAIMED')
        .map((s) => dayKeyFromIso(s.date_start)),
    ])
  )

  const openSlotEvents = slots
    .filter((s) => s.display_status === 'OPEN')
    .map((s) => ({
      id: s.id,
      department_id: s.department_id,
      date_start: s.date_start,
      date_end: s.date_end,
      location_type: s.location_type,
      status: s.status,
    }))

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
        <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2">
              {department?.name ?? 'Department'} — Scheduling
            </h1>
            <p className="font-mono text-sm text-gray-600">
              Open teaching dates, publish them to teachers, and track claims.
            </p>
          </div>
          <Link
            href={`/departments/${params.id}/sessions`}
            className="border border-black bg-white px-4 py-3 text-center font-mono text-sm text-black hover:bg-gray-50"
          >
            Back to Sessions
          </Link>
        </div>

        <ScheduleManagerPanel
          departmentId={params.id}
          slots={slots}
          groups={audienceMeta.groups}
          deptMemberCount={audienceMeta.deptMemberCount}
          orgMemberCount={audienceMeta.orgMemberCount}
          busyDayKeys={busyDayKeys}
        />

        <section className="mt-8">
          <h2 className="mb-4 text-xl font-mono font-bold">Department Calendar</h2>
          <SessionCalendar
            sessions={departmentSessions}
            subscriptionUrl={calendarUrl}
            slots={openSlotEvents}
          />
        </section>
      </div>
    </div>
  )
}
