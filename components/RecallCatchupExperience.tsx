'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordRecallPlayback, type PublicRecallQuestion } from '@/app/actions/recall'
import { RecallAnswerForm } from '@/components/RecallAnswerForm'

interface RecallCatchupExperienceProps {
  token: string
  sessionTitle: string
  audioUrl?: string
  playback?: {
    completed: boolean
    listenedSeconds: number
    durationSeconds: number
  }
  questions?: PublicRecallQuestion[]
  attemptsRemaining?: number
  completion?: { awardStatus: 'PENDING' | 'ISSUED' | 'DELIVERED' | 'FAILED' }
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

/**
 * Learner-facing catch-up package. Playback heartbeats are supporting proof,
 * not surveillance: the server credits only plausible wall-clock/media
 * progress and unlocks the quiz after the approved recap has substantially
 * played through to its end.
 */
export function RecallCatchupExperience({
  token,
  sessionTitle,
  audioUrl,
  playback,
  questions,
  attemptsRemaining,
  completion,
}: RecallCatchupExperienceProps) {
  const router = useRouter()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const heartbeatInFlight = useRef(false)
  const [listenedSeconds, setListenedSeconds] = useState(playback?.listenedSeconds ?? 0)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  async function heartbeat(finished = false) {
    const audio = audioRef.current
    if (!audio || heartbeatInFlight.current || playback?.completed) return
    heartbeatInFlight.current = true
    try {
      const progress = await recordRecallPlayback(
        token,
        audio.currentTime,
        finished || !audio.paused,
        finished
      )
      setListenedSeconds(progress.listenedSeconds)
      setPlaybackError(null)
      if (progress.completed) router.refresh()
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : 'Could not save playback progress')
    } finally {
      heartbeatInFlight.current = false
    }
  }

  useEffect(() => {
    if (playback?.completed || !audioUrl) return
    const interval = window.setInterval(() => {
      if (audioRef.current && !audioRef.current.paused) void heartbeat(false)
    }, 8_000)
    return () => window.clearInterval(interval)
    // heartbeat deliberately reads the current audio ref and server action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, playback?.completed])

  if (completion) {
    const delivered = completion.awardStatus === 'DELIVERED'
    return (
      <div className="border-2 border-green-800 bg-green-50 p-5 font-mono">
        <h2 className="text-lg font-bold text-green-900">Catch-up complete</h2>
        <p className="mt-2 text-sm leading-6 text-green-900">
          Your approved Audio Recap pathway is recorded as PRESENT with the source
          “Audio recap catch-up”. This does not claim you were physically at the original session.
        </p>
        <p className="mt-3 text-sm font-bold text-green-900">
          {delivered
            ? 'Your attendance certificate has been emailed and is available in Petrios.'
            : 'Your certificate is being prepared. Petrios will retry delivery automatically if email is delayed.'}
        </p>
      </div>
    )
  }

  if (!audioUrl || !playback) return null
  const progressPercent = playback.completed
    ? 100
    : Math.min(99, Math.round((listenedSeconds / playback.durationSeconds) * 100))

  return (
    <div className="space-y-6">
      <section className="border border-black bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-clay-700">
              Step 1 · Listen
            </p>
            <h2 className="mt-1 font-mono text-lg font-bold">Audio Recap</h2>
          </div>
          <span className="border border-black px-2 py-1 font-mono text-xs">
            {formatDuration(playback.durationSeconds)} estimated
          </span>
        </div>
        <p className="mt-3 font-mono text-sm leading-6 text-gray-600">
          Listen to the approved learning recap for “{sessionTitle}”. The five mastery
          questions unlock when playback reaches the end with sufficient listening progress.
        </p>
        <audio
          ref={audioRef}
          src={audioUrl}
          controls
          preload="metadata"
          className="mt-4 w-full"
          onPlay={() => void heartbeat(false)}
          onEnded={() => void heartbeat(true)}
        >
          Your browser does not support audio playback.
        </audio>
        <div className="mt-4" aria-label={`Listening progress ${progressPercent}%`}>
          <div className="mb-1 flex justify-between font-mono text-xs">
            <span>{playback.completed ? 'Listening confirmed' : 'Verified listening progress'}</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-3 border border-black bg-gray-100">
            <div
              className="h-full bg-clay-600 transition-[width] duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
        {playbackError && (
          <p className="mt-3 border border-red-700 bg-red-50 p-2 font-mono text-xs text-red-800">
            {playbackError}
          </p>
        )}
      </section>

      <section className="border border-black bg-white p-5">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-clay-700">
          Step 2 · Demonstrate mastery
        </p>
        <h2 className="mt-1 font-mono text-lg font-bold">Five recall questions</h2>
        {!playback.completed || !questions ? (
          <p className="mt-3 border border-gray-300 bg-gray-50 p-4 font-mono text-sm text-gray-600">
            Finish the Audio Recap to unlock the questions.
          </p>
        ) : (
          <div className="mt-4">
            <p className="mb-4 font-mono text-sm leading-6 text-gray-600">
              A perfect 5/5 completes catch-up. You have {attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining.
            </p>
            <RecallAnswerForm
              token={token}
              questions={questions}
              attemptsRemaining={attemptsRemaining ?? 0}
            />
          </div>
        )}
      </section>
    </div>
  )
}
