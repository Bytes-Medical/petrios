import { Card } from '@/components/Card'
import Link from 'next/link'
import { RecallCatchupExperience } from '@/components/RecallCatchupExperience'
import { getRecallForToken } from '@/app/actions/recall'

export const dynamic = 'force-dynamic'

/**
 * The route is public so an email deep link can land here, but completion is
 * authenticated. The HMAC token identifies the intended user and the server
 * requires that exact account before exposing session learning material.
 */
export default async function RecallPage(props: { params: Promise<{ token: string }> }) {
  const params = await props.params
  const state = await getRecallForToken(params.token)

  if (!state.valid) {
    const message =
      state.reason === 'auth-required'
        ? 'Sign in with the Petrios account this link was sent to, then open the email link again.'
        : state.reason === 'wrong-account'
          ? 'This link belongs to a different Petrios account. Sign out and use the account that received the email.'
          : state.reason === 'closed'
          ? `The catch-up window for "${state.sessionTitle}" has closed.`
          : state.reason === 'not-ready'
            ? 'This catch-up package is not available yet. Attendance, the audio, and all five questions must be approved first.'
            : state.reason === 'not-eligible'
              ? 'This pathway is only available to registered attendees whose finalized result is ABSENT.'
              : state.reason === 'attempts-exhausted'
                ? 'All three mastery attempts have been used. Contact the session organiser if you need help.'
            : 'This recall link is not valid. Please use the link from your email.'

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card variant="raised" className="max-w-md">
          <h1 className="mb-2 font-mono text-xl font-bold">
            {state.reason === 'auth-required' ? 'Sign in required' : 'Audio Recap catch-up'}
          </h1>
          <p className="font-mono text-sm text-gray-600">{message}</p>
          {state.reason === 'auth-required' && (
            <Link
              href={`/login?next=${encodeURIComponent(`/recall/${params.token}`)}`}
              className="mt-4 inline-block border border-black bg-black px-4 py-2 font-mono text-sm text-white"
            >
              Sign in to Petrios
            </Link>
          )}
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="font-mono text-2xl font-bold sm:text-3xl">Audio Recap catch-up</h1>
          <p className="mt-1 font-mono text-sm text-gray-600">
            {state.sessionTitle} — listen to the approved learning recap, then
            answer all five questions correctly.
          </p>
        </div>
        <RecallCatchupExperience
          token={params.token}
          sessionTitle={state.sessionTitle!}
          audioUrl={state.audioUrl}
          playback={state.playback}
          questions={state.questions}
          attemptsRemaining={state.attemptsRemaining}
          completion={state.completion}
        />
      </div>
    </div>
  )
}
