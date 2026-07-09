import { LOCATION_TYPE_LABELS } from '@/lib/types'
import { Card } from '@/components/Card'
import { TeacherRsvpForm } from '@/components/TeacherRsvpForm'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'

export const dynamic = 'force-dynamic'

export default async function TeacherRsvpPage({
  params,
}: {
  params: { id: string; code: string }
}) {
  const invitation = await teacherInvitationsDb.findInvitationByCodeAndSession({
    inviteCode: params.code,
    sessionId: params.id,
  })

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

  if (invitation.status !== 'PENDING') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">Already Responded</h1>
          <p className="font-mono text-sm text-gray-600">
            You have already{' '}
            {invitation.status === 'ACCEPTED' ? 'accepted' : 'declined'} this invitation.
          </p>
        </Card>
      </div>
    )
  }

  const session = await sessionsDb.findSessionById(params.id)
  const startDate = session ? new Date(session.date_start) : null
  const endDate = session ? new Date(session.date_end) : null

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

        {session && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">{session.title}</h2>
            <div className="space-y-2 font-mono text-sm mb-6">
              {startDate && endDate && (
                <>
                  <p>
                    <strong>Date:</strong>{' '}
                    {startDate.toLocaleDateString('en-GB', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                  <p>
                    <strong>Time:</strong>{' '}
                    {startDate.toLocaleTimeString('en-GB', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    -{' '}
                    {endDate.toLocaleTimeString('en-GB', {
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

            <div className="border-t border-gray-300 pt-4">
              <TeacherRsvpForm inviteCode={params.code} />
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
