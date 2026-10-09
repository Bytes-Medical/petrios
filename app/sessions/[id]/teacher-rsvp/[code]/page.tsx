import { LOCATION_TYPE_LABELS, type Session } from '@/lib/types'
import { sessionMeetingUrl } from '@/lib/jitsi'
import { formatInAppTimeZone } from '@/lib/datetime'
import { meetingDisplayName } from '@/lib/contacts'
import { isInviteCode, isSessionId } from '@/lib/meeting/access'
import { buildMeetingRoomView } from '@/lib/meeting/view'
import { inviteCodeCapabilityOrWarn } from '@/lib/teacher-invitation-capability'
import { Card } from '@/components/Card'
import { JitsiMeetingPanel } from '@/components/JitsiMeetingPanel'
import { TeacherRsvpForm } from '@/components/TeacherRsvpForm'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'

export const dynamic = 'force-dynamic'

/**
 * Name shown to the room for an external teacher: the invitation names,
 * never the email (the same rule getExternalTeacherMeetingJoin signs).
 */
function externalTeacherDisplayName(invitation: {
  first_name: string | null
  last_name: string | null
}): string {
  const name = meetingDisplayName({ first_name: invitation.first_name, last_name: invitation.last_name })
  return name === 'Attendee' ? 'Guest teacher' : name
}

function SessionDetails({ session }: { session: Session }) {
  return (
    <div className="space-y-2 font-mono text-sm">
      {session.date_start && session.date_end && (
        <>
          <p>
            <strong>Date:</strong>{' '}
            {formatInAppTimeZone(session.date_start, {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
          <p>
            <strong>Time:</strong>{' '}
            {formatInAppTimeZone(session.date_start, {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            -{' '}
            {formatInAppTimeZone(session.date_end, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </>
      )}
      <p>
        <strong>Location:</strong>{' '}
        {LOCATION_TYPE_LABELS[session.location_type as keyof typeof LOCATION_TYPE_LABELS] || session.location_type}
      </p>
      {session.description && (
        <p className="mt-2 whitespace-pre-wrap">{session.description}</p>
      )}
    </div>
  )
}

export default async function TeacherRsvpPage(
  props: {
    params: Promise<{ id: string; code: string }>
  }
) {
  const params = await props.params;
  // A malformed link never reaches the database (a non-UUID id is a query error).
  const invitation =
    isSessionId(params.id) && isInviteCode(params.code)
      ? await teacherInvitationsDb.findInvitationByCodeAndSession({
          inviteCode: params.code,
          sessionId: params.id,
        })
      : null

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">Invitation Not Found</h1>
          <p className="font-mono text-sm text-gray-600">
            This invitation link is invalid or has expired.
          </p>
        </Card>
      </div>
    )
  }

  if (invitation.status === 'DECLINED') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">Already Responded</h1>
          <p className="font-mono text-sm text-gray-600">
            You have already declined this invitation.
          </p>
        </Card>
      </div>
    )
  }

  // The matched (invite code, session id) is the capability. Visitors here
  // are usually signed out and RLS hides sessions from anonymous readers, so
  // the session is read with the service role, pinned to the invitation's
  // org — but only once the operator has removed migration 017's public
  // teacher_invitations policies (TEACHER_INVITATIONS_RLS_LOCKED, spec/13).
  // Until then invite codes are world-readable, so this page falls back to
  // the RLS read (signed-in organisation members only).
  const codeIsCapability = inviteCodeCapabilityOrWarn()
  const session = codeIsCapability
    ? await sessionsDb.findSessionForInvitationAsSystem({
        sessionId: params.id,
        orgId: invitation.org_id,
      })
    : await sessionsDb.findSessionById(params.id)

  if (invitation.status === 'ACCEPTED') {
    // Accepted external teachers have no dashboard: this page is where they
    // enter the video room, or find the Teams link.
    const isVideoSession = session?.location_type === 'JITSI'
    const roomView =
      session && isVideoSession
        ? buildMeetingRoomView({ session, displayName: externalTeacherDisplayName(invitation) })
        : null
    const joinUrl =
      session && !isVideoSession
        ? sessionMeetingUrl(session, { kind: 'external_teacher', inviteCode: params.code })
        : null

    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
              Teaching session
            </h1>
            <p className="font-mono text-sm text-gray-600">
              You have accepted this invitation. Thank you for teaching. Keep this page&apos;s link:
              it is where you join the session on the day.
            </p>
          </div>

          {session ? (
            <>
              <Card className="mb-6">
                <h2 className="text-xl font-mono font-bold mb-4 break-words">{session.title}</h2>
                <SessionDetails session={session} />
              </Card>

              {isVideoSession && roomView && (codeIsCapability || !roomView.embedded) ? (
                <JitsiMeetingPanel
                  view={roomView}
                  audience={{ kind: 'external_teacher', inviteCode: params.code }}
                />
              ) : isVideoSession ? (
                <Card>
                  <p className="font-mono text-sm text-gray-600">
                    Your organiser has not finished setting up video rooms for invited teachers yet.
                    Please contact them for a way to join this session.
                  </p>
                </Card>
              ) : joinUrl ? (
                <Card>
                  <p className="font-mono text-sm">
                    Join the session here:{' '}
                    <a href={joinUrl} className="underline break-all" target="_blank" rel="noopener noreferrer">
                      {joinUrl}
                    </a>
                  </p>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <p className="font-mono text-sm text-gray-600">
                The session details are not available on this page. Use the links in your
                invitation and reminder emails, or contact the organiser who invited you.
              </p>
            </Card>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
            Teaching Invitation
          </h1>
          <p className="font-mono text-sm text-gray-600">
            You have been invited to teach a session
          </p>
        </div>

        <Card>
          {session ? (
            <>
              <h2 className="text-xl font-mono font-bold mb-4">{session.title}</h2>
              <div className="mb-6">
                <SessionDetails session={session} />
              </div>
            </>
          ) : (
            <p className="mb-6 font-mono text-sm text-gray-600">
              The session details are in your invitation email.
            </p>
          )}

          <div className="border-t border-gray-300 pt-4">
            <TeacherRsvpForm inviteCode={params.code} />
          </div>
        </Card>
      </div>
    </div>
  )
}
