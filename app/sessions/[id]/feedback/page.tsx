import { redirect } from 'next/navigation'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { FeedbackForm } from '@/components/FeedbackForm'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import { getFeedbackWindowBounds, getFeedbackWindowStatus } from '@/lib/feedback-window'
import { formatInAppTimeZone } from '@/lib/datetime'
import * as sessionsDb from '@/lib/db/sessions'

// The open/closed state depends on the current minute, so never serve a cached render.
export const dynamic = 'force-dynamic'

function formatWhen(value: Date) {
  return formatInAppTimeZone(value, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function SessionFeedbackPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const session = await sessionsDb.findPublishedSessionWithFeedbackFields(params.id)

  if (!session || session.status !== 'PUBLISHED') {
    redirect('/')
  }

  const bounds = getFeedbackWindowBounds(session)
  const feedbackStatus = getFeedbackWindowStatus(session)

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
            {session.title}
          </h1>
          {bounds ? (
            <p className="font-mono text-sm text-gray-600 mb-1">
              {formatInAppTimeZone(session.date_start, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}{' '}
              {formatInAppTimeZone(session.date_start, { hour: '2-digit', minute: '2-digit' })}
              {' '}-{' '}
              {formatInAppTimeZone(session.date_end, { hour: '2-digit', minute: '2-digit' })}
            </p>
          ) : null}
          <p className="font-mono text-sm text-gray-600">Session Feedback</p>
        </div>

        <Card>
          {feedbackStatus === 'OPEN' ? (
            <FeedbackForm
              sessionId={params.id}
              sessionTitle={session.title}
              feedbackFields={normalizeDepartmentFeedbackFields(
                session.departments?.feedback_form_fields
              )}
            />
          ) : (
            <div role="status">
              <h2 className="text-lg font-mono font-bold mb-2">
                {feedbackStatus === 'NOT_YET_OPEN' ? 'Feedback is not open yet' : 'Feedback is closed'}
              </h2>
              <p className="font-mono text-sm text-gray-600">
                {!bounds
                  ? 'Feedback is not available for this session.'
                  : feedbackStatus === 'NOT_YET_OPEN'
                    ? `Feedback for this session opens on ${formatWhen(bounds.opensAt)}. Please come back then.`
                    : `The feedback window for this session closed on ${formatWhen(bounds.closesAt)}. New responses can no longer be submitted.`}
              </p>
            </div>
          )}
        </Card>

      </div>
    </div>
  )
}
