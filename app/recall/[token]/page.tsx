import { Card } from '@/components/Card'
import { RecallAnswerForm } from '@/components/RecallAnswerForm'
import { getRecallForToken } from '@/app/actions/recall'

export const dynamic = 'force-dynamic'

/**
 * PUBLIC recall answer page (listed in proxy.ts). The HMAC token from the
 * recall email authorizes the attempt — no login, one attempt per person
 * per session. Attendees get retention practice; absentees who pass earn
 * caught-up attendance.
 */
export default async function RecallPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  const state = await getRecallForToken(params.token)

  if (!state.valid) {
    const message =
      state.reason === 'answered'
        ? `You've already answered for "${state.sessionTitle}" — you scored ${state.previousResult?.score}/${state.previousResult?.total}.`
        : state.reason === 'closed'
          ? `The answer window for "${state.sessionTitle}" has closed (21 days after the session).`
          : state.reason === 'not-ready'
            ? 'These recall questions are not available yet — the organiser may not have approved them.'
            : 'This recall link is not valid. Please use the link from your email.'

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card variant="raised" className="max-w-md">
          <h1 className="mb-2 font-mono text-xl font-bold">
            {state.reason === 'answered' ? 'Already answered' : 'Recall questions'}
          </h1>
          <p className="font-mono text-sm text-gray-600">{message}</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="font-mono text-2xl font-bold sm:text-3xl">Quick recall</h1>
          <p className="mt-1 font-mono text-sm text-gray-600">
            {state.sessionTitle} — three questions, one attempt. If you missed
            the session, passing (2 of 3) records your attendance as caught up.
          </p>
        </div>
        <RecallAnswerForm token={params.token} questions={state.questions!} />
      </div>
    </div>
  )
}
