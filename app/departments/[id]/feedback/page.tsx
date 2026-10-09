import { LOCATION_TYPE_LABELS } from '@/lib/types'
import { Card } from '@/components/Card'
import { FeedbackForm } from '@/components/FeedbackForm'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import { isFeedbackWindowOpen } from '@/lib/feedback-window'
import { formatInAppTimeZone } from '@/lib/datetime'
import * as departmentsDb from '@/lib/db/departments'
import * as sessionsDb from '@/lib/db/sessions'

// Deliberately force-dynamic despite being public: the page computes the
// "active session" from a minute-granularity time window, so revalidate
// caching would delay a session's feedback window opening. Not on the
// authed click path — see spec/07 latency conventions.
export const dynamic = 'force-dynamic'

export default async function DepartmentFeedbackPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const department = await departmentsDb.findDepartmentPublic(params.id)

  if (!department) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">Department Not Found</h1>
          <p className="font-mono text-sm text-gray-600">
            This department does not exist.
          </p>
        </Card>
      </div>
    )
  }

  const sessions = await sessionsDb.listPublishedSessionsForDepartmentPublic(params.id)
  const activeSession = sessions.find((session) => isFeedbackWindowOpen(session))

  if (!activeSession) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">{department.name}</h1>
          <p className="font-mono text-sm text-gray-600">
            Feedback is not open for any session in this department right now. Please check back during a scheduled session.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <p className="font-mono text-sm text-gray-600 mb-1">{department.name}</p>
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
            {activeSession.title}
          </h1>
          <div className="space-y-1 font-mono text-sm text-gray-600">
            <p>
              {formatInAppTimeZone(activeSession.date_start, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}{' '}
              {formatInAppTimeZone(activeSession.date_start, {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              -{' '}
              {formatInAppTimeZone(activeSession.date_end, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <p>
              {LOCATION_TYPE_LABELS[activeSession.location_type as keyof typeof LOCATION_TYPE_LABELS] || activeSession.location_type}
            </p>
          </div>
        </div>

        <Card>
          <h2 className="text-lg font-mono font-bold mb-4">Session Feedback</h2>
          <p className="font-mono text-sm text-gray-600 mb-6">
            Please complete this identified feedback form. Attendance is recorded and finalized separately.
          </p>
          <FeedbackForm
            sessionId={activeSession.id}
            sessionTitle={activeSession.title}
            feedbackFields={normalizeDepartmentFeedbackFields(
              department.feedback_form_fields
            )}
          />
        </Card>

      </div>
    </div>
  )
}
