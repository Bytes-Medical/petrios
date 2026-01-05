import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, getCurrentUserId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getSession, getSessionTeachers } from '@/app/actions/sessions'
import { getDepartment } from '@/app/actions/departments'
import { getDepartmentMemberUsers } from '@/app/actions/departments'
import { getAttendance } from '@/app/actions/attendance'
import { isDepartmentModerator } from '@/lib/auth'
import Link from 'next/link'
import { ManageSessionTabs } from '@/components/ManageSessionTabs'

export default async function ManageSessionPage({
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
  const department = await getDepartment(session.department_id)
  const canManage = await isDepartmentModerator(session.department_id)

  if (!canManage) {
    redirect(`/sessions/${params.id}`)
  }

  const teachers = await getSessionTeachers(params.id)
  const departmentMembers = await getDepartmentMemberUsers(session.department_id)
  const attendance = await getAttendance(params.id)
  const currentUserId = await getCurrentUserId()

  const checkinOpenMins = session.checkin_open_mins_before || 15
  const checkinCloseMins = session.checkin_close_mins_after || 45

  const isCheckInWindow = () => {
    const now = new Date()
    const startTime = new Date(session.date_start)
    const checkInStart = new Date(startTime.getTime() - checkinOpenMins * 60 * 1000)
    const checkInEnd = new Date(startTime.getTime() + checkinCloseMins * 60 * 1000)
    return now >= checkInStart && now <= checkInEnd
  }

  const hasCheckedIn = attendance.some(a => a.user_id === currentUserId && (a.status === 'PRESENT' || a.status === 'LATE'))

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link href={`/sessions/${params.id}`} className="font-mono text-sm underline mb-3 sm:mb-4 inline-block">
            ← Back to session
          </Link>
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mt-3 sm:mt-4 break-words">Manage Session</h1>
          <p className="font-mono text-sm text-gray-600 mt-2 break-words">{session.title}</p>
        </div>

        <ManageSessionTabs
          session={session}
          department={department}
          teachers={teachers}
          departmentMembers={departmentMembers}
          attendance={attendance}
          isAttendanceLocked={session.attendance_locked || false}
          currentUserId={currentUserId}
          hasCheckedIn={hasCheckedIn}
          isCheckInWindow={isCheckInWindow()}
          checkinOpenMins={checkinOpenMins}
          checkinCloseMins={checkinCloseMins}
        />
      </div>
    </div>
  )
}
