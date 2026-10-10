import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, getCurrentUserId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { getSession, getSessionTeachers } from '@/app/actions/sessions'
import { getAttendance } from '@/app/actions/attendance'
import { SessionTabs } from '@/components/SessionTabs'
import { JitsiMeetingPanel } from '@/components/JitsiMeetingPanel'
import { Button } from '@/components/Button'
import Link from 'next/link'
import { isDepartmentModerator } from '@/lib/auth'
import { meetingDisplayName } from '@/lib/contacts'
import { buildMeetingRoomView } from '@/lib/meeting/view'
import { loginUrlFor } from '@/lib/safe-next-path'
import { getApprovedAudioRecap } from '@/app/actions/audio-recaps'
import { AudioRecapPlayer } from '@/components/AudioRecapPlayer'
import * as onboardingDb from '@/lib/db/onboarding'
import { canUploadSessionDocuments, getSessionDocuments } from '@/app/actions/session-documents'
import { getMyRotaFlag } from '@/app/actions/rota-attendance'
import { RotaOwnFlagNotice } from '@/components/rota/RotaOwnFlagNotice'

export default async function SessionPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const user = await getCurrentUser()

  if (!user) {
    // Back to this session (and its video room) after sign-in.
    redirect(loginUrlFor(`/sessions/${params.id}`))
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  // Stage 1: the reads below key off session fields; then fetch concurrently.
  const session = await getSession(params.id)
  // Petrios Meet: every JITSI session shows its room panel; the panel itself
  // explains a draft, cancelled, not-yet-open or ended room.
  const isVideoSession = session.location_type === 'JITSI'

  const [
    teachers,
    attendance,
    canManage,
    approvedRecap,
    videoProfile,
    documents,
    canUploadDocuments,
    ownRotaFlag,
  ] = await Promise.all([
    getSessionTeachers(params.id),
    getAttendance(params.id),
    isDepartmentModerator(session.department_id),
    getApprovedAudioRecap(params.id),
    isVideoSession ? onboardingDb.findProfileByUserId(user.id) : Promise.resolve(null),
    getSessionDocuments(params.id),
    canUploadSessionDocuments(params.id),
    // Rota availability (spec/14): the caller's own flag only; null when
    // rota is unavailable here; never throws.
    getMyRotaFlag(params.id),
  ])

  // Mode, room window and availability are resolved on the server; the name
  // is what the room shows (never an email).
  // Hosts (department moderators, ACCEPTED teachers) moderate the room and
  // are not self-checked-in on joining (the same rule getMeetingJoin signs).
  const meetingView = isVideoSession
    ? buildMeetingRoomView({
        session,
        displayName: meetingDisplayName(videoProfile),
        viewerIsModerator:
          canManage || teachers.some((teacher) => teacher.user_id === user.id && teacher.status === 'ACCEPTED'),
      })
    : null

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <Link href={`/departments/${session.department_id}/sessions`} className="font-mono text-sm underline mb-3 sm:mb-4 inline-block">
            ← Back to sessions
          </Link>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mt-3 sm:mt-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-mono font-bold break-words">{session.title}</h1>
              {session.description && (
                <p className="font-mono text-sm text-gray-600 mt-2">{session.description}</p>
              )}
            </div>
            {canManage && (
              <Link href={`/sessions/${params.id}/manage`}>
                <Button variant="secondary">Manage Session</Button>
              </Link>
            )}
          </div>
        </div>

        {ownRotaFlag && <RotaOwnFlagNotice flag={ownRotaFlag} />}

        {meetingView && <JitsiMeetingPanel view={meetingView} audience={{ kind: 'member' }} />}

        {approvedRecap ? (
          // #recap: the newsletter's "Listen to the Audio Recap" link target.
          // Rendered only for an approved recap, after this page's own checks.
          <div id="recap" className="mb-6 scroll-mt-24">
            <AudioRecapPlayer
              sessionId={params.id}
              researchSources={approvedRecap.researchSources}
            />
          </div>
        ) : null}

        <SessionTabs
          session={session}
          sessionId={params.id}
          teachers={teachers}
          attendance={attendance.filter((row) => row.user_id === user.id)}
          documents={documents}
          canUploadDocuments={canUploadDocuments}
          currentUserId={user.id}
          serverNow={new Date().toISOString()}
        />
      </div>
    </div>
  )
}
