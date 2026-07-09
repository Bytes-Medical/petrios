import { LOCATION_TYPE_LABELS } from '@/lib/types'
import { Card } from '@/components/Card'
import { FeedbackForm } from '@/components/FeedbackForm'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import * as departmentsDb from '@/lib/db/departments'
import * as sessionsDb from '@/lib/db/sessions'

export const dynamic = 'force-dynamic'

export default async function DepartmentFeedbackPage({
  params,
}: {
  params: { id: string }
}) {
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

  // Find active published session for this department
  // Active = 15 mins before date_start to feedback_valid_mins_after_end after date_end
  const sessions = await sessionsDb.listPublishedSessionsForDepartmentPublic(params.id)
  const now = new Date()

  const activeSession = sessions.find((session) => {
    const start = new Date(session.date_start)
    const end = new Date(session.date_end)
    const windowBefore = 15 // minutes before start
    const windowAfter = session.feedback_valid_mins_after_end || 120 // minutes after end

    const windowStart = new Date(start.getTime() - windowBefore * 60 * 1000)
    const windowEnd = new Date(end.getTime() + windowAfter * 60 * 1000)

    return now >= windowStart && now <= windowEnd
  })

  if (!activeSession) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <Card>
          <h1 className="text-xl font-mono font-bold mb-2">{department.name}</h1>
          <p className="font-mono text-sm text-gray-600">
            No active session right now. Please check back during a scheduled session.
          </p>
        </Card>
      </div>
    )
  }

  const startDate = new Date(activeSession.date_start)
  const endDate = new Date(activeSession.date_end)

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
              {startDate.toLocaleDateString('en-GB', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}{' '}
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
            <p>
              {LOCATION_TYPE_LABELS[activeSession.location_type as keyof typeof LOCATION_TYPE_LABELS] || activeSession.location_type}
            </p>
          </div>
        </div>

        <Card>
          <h2 className="text-lg font-mono font-bold mb-4">Session Feedback</h2>
          <p className="font-mono text-sm text-gray-600 mb-6">
            Please complete this form to record your attendance and provide feedback.
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
