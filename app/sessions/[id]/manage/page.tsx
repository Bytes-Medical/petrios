import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { getSession, getSessionTeachers } from '@/app/actions/sessions'
import { getDepartment } from '@/app/actions/departments'
import { getDepartmentMemberUsers } from '@/app/actions/departments'
import { getAttendance } from '@/app/actions/attendance'
import { isDepartmentModerator, isPersonalWorkspace } from '@/lib/auth'
import { getTeacherEmailHistory } from '@/app/actions/emails'
import { getSessionInvitations } from '@/app/actions/teacher-invitations'
import { getRecallSetForSession } from '@/app/actions/recall'
import * as feedbackActionsDb from '@/lib/db/feedback-actions'
import Link from 'next/link'
import { ManageSessionTabs } from '@/components/ManageSessionTabs'

export default async function ManageSessionPage(
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

  const session = await getSession(params.id)
  const department = await getDepartment(session.department_id)
  const canManage = await isDepartmentModerator(session.department_id)

  if (!canManage) {
    redirect(`/sessions/${params.id}`)
  }

  const teachers = await getSessionTeachers(params.id)
  const departmentMembers = await getDepartmentMemberUsers(session.department_id)
  const attendance = await getAttendance(params.id)
  const emailHistory = await getTeacherEmailHistory(params.id)
  const invitations = await getSessionInvitations(params.id)
  const isPersonal = await isPersonalWorkspace(orgId)
  const recallSet = await getRecallSetForSession(params.id)
  const feedbackActions = await feedbackActionsDb.listActionsForSession(params.id)

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
          emailHistory={emailHistory}
          invitations={invitations}
          isPersonal={isPersonal}
          recallSet={recallSet}
          feedbackActions={feedbackActions}
        />
      </div>
    </div>
  )
}
