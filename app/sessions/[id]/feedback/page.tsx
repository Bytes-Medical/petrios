import { redirect } from 'next/navigation'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { FeedbackForm } from '@/components/FeedbackForm'
import { normalizeDepartmentFeedbackFields } from '@/lib/feedback-form'
import * as sessionsDb from '@/lib/db/sessions'

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

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-2 break-words">
            {session.title}
          </h1>
          <p className="font-mono text-sm text-gray-600">Session Feedback</p>
        </div>

        <Card>
          <FeedbackForm
            sessionId={params.id}
            sessionTitle={session.title}
            feedbackFields={normalizeDepartmentFeedbackFields(
              session.departments?.feedback_form_fields
            )}
          />
        </Card>
      </div>
    </div>
  )
}
