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
import { getAudioRecap } from '@/app/actions/audio-recaps'
import { opsEnabled } from '@/lib/ops/flags'
import Link from 'next/link'
import { ManageSessionTabs, type MeetingCardInfo } from '@/components/ManageSessionTabs'
import { meetingGuestUrl, sessionMeetingUrl } from '@/lib/jitsi'
import { getMeetingConfig } from '@/lib/meeting/config'
import type { MeetingConfig } from '@/lib/meeting/types'
import type { Session } from '@/lib/types'
import { canUploadSessionDocuments, getSessionDocuments } from '@/app/actions/session-documents'
import { getSessionAttendanceGovernance } from '@/app/actions/attendance-evidence'

/**
 * The overview's join link. sessionMeetingUrl never throws; without a public
 * app URL a token-mode room has no absolute link, so fall back to the
 * relative session page rather than showing nothing.
 */
function memberMeetingLink(session: Session, config: MeetingConfig): string | null {
  const link = sessionMeetingUrl(session, { kind: 'member' }, config)
  if (link) return link
  return session.location_type === 'JITSI' ? `/sessions/${session.id}` : null
}

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

  // Stage 1: everything below keys off session.department_id.
  const session = await getSession(params.id)

  // Stage 2: all reads, fetched concurrently. The moderator gate runs after
  // the fan-out — each action still enforces its own auth internally, so a
  // non-moderator wastes a few reads on the redirect path but sees nothing.
  const showAudioRecap = opsEnabled()
  const [
    department,
    canManage,
    teachers,
    departmentMembers,
    attendance,
    emailHistory,
    invitations,
    isPersonal,
    recallSet,
    audioRecap,
    documents,
    canUploadDocuments,
    attendanceGovernance,
  ] = await Promise.all([
    getDepartment(session.department_id),
    isDepartmentModerator(session.department_id),
    getSessionTeachers(params.id),
    getDepartmentMemberUsers(session.department_id),
    getAttendance(params.id),
    getTeacherEmailHistory(params.id),
    getSessionInvitations(params.id),
    isPersonalWorkspace(orgId),
    getRecallSetForSession(params.id),
    showAudioRecap ? getAudioRecap(params.id) : Promise.resolve(null),
    getSessionDocuments(params.id, true),
    canUploadSessionDocuments(params.id),
    getSessionAttendanceGovernance(params.id),
  ])

  if (!canManage) {
    redirect(`/sessions/${params.id}`)
  }

  // Petrios Meet is resolved on the server (lib/meeting/config.ts); the
  // client card only renders these facts. The configuration error names
  // variables, never secret values, and this page is moderator-only.
  const meetingConfig = getMeetingConfig()
  const meetingLink = memberMeetingLink(session, meetingConfig)
  const meetingCard: MeetingCardInfo = {
    mode: meetingConfig.ok ? meetingConfig.mode : 'unavailable',
    tokenProtected: meetingConfig.ok && meetingConfig.tokenAuth !== 'none',
    domain: meetingConfig.ok ? meetingConfig.domain : null,
    guestUrl: meetingGuestUrl(session.id, meetingConfig),
    configurationError: meetingConfig.ok ? null : meetingConfig.error,
  }

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
          meetingLink={meetingLink}
          meetingCard={meetingCard}
          department={department}
          teachers={teachers}
          departmentMembers={departmentMembers}
          attendance={attendance}
          emailHistory={emailHistory}
          invitations={invitations}
          isPersonal={isPersonal}
          recallSet={recallSet}
          showAudioRecap={showAudioRecap}
          audioRecap={audioRecap}
          documents={documents}
          canUploadDocuments={canUploadDocuments}
          currentUserId={user.id}
          attendanceGovernance={attendanceGovernance}
        />
      </div>
    </div>
  )
}
