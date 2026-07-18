'use client'

import { useState, useTransition } from 'react'
import { summarizeSessionFeedback } from '@/app/actions/feedback'
import { Button } from './Button'

interface FeedbackSummaryPanelProps {
  sessionId: string
}

export function FeedbackSummaryPanel({ sessionId }: FeedbackSummaryPanelProps) {
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const generate = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await summarizeSessionFeedback(sessionId)
        setSummary(result.summary)
        setError(result.error)
      } catch {
        setError('Failed to generate the summary. Try again.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Let AI read identity-field-omitted response text and surface possible
        themes. Free text can still contain identifying details, so verify the
        result against the raw responses before using it. Summaries stay on this page.
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
        <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_rgba(31,29,26,0.9)]">
          <p className="font-mono text-xs uppercase tracking-wider text-gray-500 mb-2">
            AI summary — verify against the raw responses
          </p>
          <pre className="font-mono text-sm whitespace-pre-wrap break-words">{summary}</pre>
        </div>
      )}
    </div>
  )
}
