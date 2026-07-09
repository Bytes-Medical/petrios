import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, requireDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { ScheduleManagerPanel } from '@/components/ScheduleManagerPanel'
import { SessionCalendar } from '@/components/SessionCalendar'
import { getDepartmentSlots } from '@/app/actions/teaching-slots'
import { getAddressBook } from '@/app/actions/contacts'
import { getSessionsForOrg, getCalendarSubscriptionUrl } from '@/app/actions/sessions'
import { getDepartmentsForOrg, getDepartmentMembersWithProfiles } from '@/app/actions/departments'
import { getOrgMembersForManagement } from '@/app/actions/member-onboarding'

export const dynamic = 'force-dynamic'

function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default async function DepartmentSchedulePage({
  params,
}: {
  params: { id: string }
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const orgId = await getCurrentOrgId()
  if (!orgId) redirect('/dashboard')

  try {
    await requireDepartmentModerator(params.id)
  } catch {
    redirect('/dashboard')
  }

  const [slots, addressBook, sessions, departments, deptMembers, orgMembers, calendarUrl] =
    await Promise.all([
      getDepartmentSlots(params.id),
      getAddressBook(),
      getSessionsForOrg(orgId),
      getDepartmentsForOrg(orgId),
      getDepartmentMembersWithProfiles(params.id),
      getOrgMembersForManagement(),
      getCalendarSubscriptionUrl(orgId, params.id),
    ])

  const department = departments.find((d) => d.id === params.id)
  const departmentSessions = sessions.filter((s) => s.department_id === params.id)

  const busyDayKeys = Array.from(
    new Set([
      ...departmentSessions.map((s) => dayKeyOf(s.date_start)),
      ...slots
        .filter((s) => s.status === 'OPEN' || s.status === 'CLAIMED')
        .map((s) => dayKeyOf(s.date_start)),
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
          groups={addressBook.groups}
          deptMemberCount={deptMembers.length}
          orgMemberCount={orgMembers.length}
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
