'use client'

import { useState, useTransition } from 'react'
import { summarizeSessionFeedback } from '@/app/actions/feedback'
import { Button } from './Button'
import { Textarea } from './Textarea'
import { ReleaseTeacherFeedbackPanel } from './ReleaseTeacherFeedbackPanel'
import type { TeacherInvitation } from '@/lib/types'

interface FeedbackSummaryPanelProps {
  sessionId: string
  invitations: TeacherInvitation[]
  registeredTeacherCount: number
}

export function FeedbackSummaryPanel({
  sessionId,
  invitations,
  registeredTeacherCount,
}: FeedbackSummaryPanelProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const generate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await summarizeSessionFeedback(sessionId)
        setSummary(result.summary)
        setReviewed(false)
        setError(result.error)
      } catch {
        setError('Failed to generate the summary. Try again.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Generate a working draft from identity-field-omitted feedback, then edit
        and approve it before sending. Petrios freezes the reviewed text and
        question-level scores into the released report. AI drafting is available
        as soon as one response exists. Treat small-cohort themes as directional
        evidence and check that the wording cannot identify a respondent.
      </p>

      <Button onClick={generate} disabled={isPending} variant="secondary">
        {isPending
          ? 'Reading feedback…'
          : summary
            ? 'Regenerate summary'
            : 'Generate AI summary'}
      </Button>

      {error && (
        <p className="font-mono text-sm text-red-700 border border-red-700 bg-red-50 px-3 py-2">
          {error}
        </p>
      )}

      {summary && (
        <div className="space-y-3 border-2 border-black bg-white p-4 shadow-[4px_4px_0_rgba(31,29,26,0.9)]">
          <Textarea
            label="Teacher-facing narrative"
            value={summary}
            maxLength={4000}
            rows={12}
            onChange={(event) => {
              setSummary(event.target.value)
              setReviewed(false)
            }}
          />
          <p className="font-mono text-xs text-gray-600">
            Edit freely. Remove anything identifying, unsupported, vague, or
            unsuitable for the teacher. The email contains this text exactly as reviewed.
          </p>
          <label className="flex items-start gap-2 font-mono text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I reviewed this narrative against the source feedback and approve it for release.</span>
          </label>
        </div>
      )}

      <div className="border-t border-gray-300 pt-5">
        <ReleaseTeacherFeedbackPanel
          sessionId={sessionId}
          invitations={invitations}
          registeredTeacherCount={registeredTeacherCount}
          reviewedSummary={reviewed && summary?.trim() ? summary.trim() : undefined}
        />
      </div>
    </div>
  )
}
