'use client'

import { useState } from 'react'
import { submitRecallAnswers, type PublicRecallQuestion, type RecallSubmitResult } from '@/app/actions/recall'
import { Badge } from './Badge'
import { Button } from './Button'
import { cn } from '@/lib/utils'

interface RecallAnswerFormProps {
  token: string
  questions: PublicRecallQuestion[]
  attemptsRemaining: number
}

/** Three-attempt mastery quiz; answers stay hidden while a retry remains. */
export function RecallAnswerForm({ token, questions, attemptsRemaining }: RecallAnswerFormProps) {
  const [selected, setSelected] = useState<(number | null)[]>(questions.map(() => null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecallSubmitResult | null>(null)

  const complete = selected.every((s) => s !== null)

  async function handleSubmit() {
    setBusy(true)
    setError(null)
    try {
      setResult(await submitRecallAnswers(token, selected as number[]))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between border border-black px-4 py-3">
          <p className="font-mono text-lg font-bold">
            {result.score} / {result.total}
          </p>
          <Badge variant={result.passed ? 'success' : 'danger'}>
            {result.passed ? 'Passed' : 'Not passed'}
          </Badge>
        </div>

        {result.caughtUp && (
          <p className="border border-green-700 bg-green-50 px-4 py-3 font-mono text-sm text-green-800">
            Catch-up completed. Your attendance is now PRESENT through the
            transparent “Audio recap catch-up” source; this does not claim you
            were physically present at the original session. Your certificate
            {result.awardStatus === 'DELIVERED' ? ' has been emailed.' : ' is being prepared.'}
          </p>
        )}
        {result.attendanceLocked && (
          <p className="border border-amber-600 bg-amber-50 px-4 py-3 font-mono text-sm text-amber-800">
            You passed, but attendance for this session is locked. Contact the
            session organiser to have your catch-up recorded.
          </p>
        )}
        {result.kind === 'CATCH_UP' && !result.passed && (
          <p className="border border-gray-300 bg-gray-50 px-4 py-3 font-mono text-sm text-gray-700">
            {result.attemptsRemaining > 0
              ? `You need 5/5 to complete catch-up. The answer key stays hidden while you still have ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining.`
              : 'All attempts have been used. Review the explanations below; attendance has not changed.'}
          </p>
        )}

        <div className="space-y-3">
          {result.review.map((r, i) => (
            <div
              key={i}
              className={cn(
                'border px-4 py-3',
                r.wasCorrect ? 'border-green-700 bg-green-50' : 'border-red-700 bg-red-50'
              )}
            >
              <p className="font-mono text-sm font-bold">{r.question}</p>
              <p className="mt-1 font-mono text-xs">
                Correct answer: <strong>{r.correct}</strong>
              </p>
              <p className="mt-1 font-mono text-xs text-gray-700">{r.explanation}</p>
            </div>
          ))}
        </div>

        {!result.passed && result.attemptsRemaining > 0 && (
          <Button
            onClick={() => {
              setSelected(questions.map(() => null))
              setResult(null)
            }}
          >
            Try again ({result.attemptsRemaining} remaining)
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {questions.map((q, qi) => (
        <div key={qi} className="border border-black p-4">
          <p className="font-mono text-sm font-bold">
            {qi + 1}. {q.question}
          </p>
          <div className="mt-3 space-y-2">
            {q.options.map((option, oi) => (
              <label
                key={oi}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border px-3 py-2 font-mono text-sm',
                  selected[qi] === oi
                    ? 'border-clay-600 bg-clay-50'
                    : 'border-gray-300 hover:border-black'
                )}
              >
                <input
                  type="radio"
                  name={`q-${qi}`}
                  checked={selected[qi] === oi}
                  onChange={() =>
                    setSelected((current) => current.map((s, i) => (i === qi ? oi : s)))
                  }
                />
                {option}
              </label>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          {error}
        </p>
      )}

      <Button onClick={handleSubmit} disabled={!complete || busy}>
        {busy ? 'Submitting…' : `Submit answers (${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} available)`}
      </Button>
    </div>
  )
}
