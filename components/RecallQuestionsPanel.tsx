'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveRecallQuestions } from '@/app/actions/recall'
import type { RecallQuestionSet } from '@/lib/db/recall'
import type { RecallQuestion } from '@/lib/recall'
import { Badge } from './Badge'
import { Button } from './Button'

interface RecallQuestionsPanelProps {
  sessionId: string
  initialSet: RecallQuestionSet | null
}

/**
 * Moderator review of AI-drafted recall questions. Nothing is emailed until
 * a moderator has (optionally edited and) APPROVED the set here — this is
 * the human gate on AI-generated content, and it also enables catch-up
 * attendance for absentees.
 */
export function RecallQuestionsPanel({ sessionId, initialSet }: RecallQuestionsPanelProps) {
  const router = useRouter()
  const [questions, setQuestions] = useState<RecallQuestion[]>(initialSet?.questions ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!initialSet) {
    return (
      <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
        No question set drafted yet. The AI drafts one automatically a couple
        of days after the session ends (requires the session to have ended and
        AI to be configured).
      </p>
    )
  }

  function updateQuestion(qi: number, patch: Partial<RecallQuestion>) {
    setQuestions((current) => current.map((q, i) => (i === qi ? { ...q, ...patch } : q)))
  }

  function updateOption(qi: number, oi: number, value: string) {
    setQuestions((current) =>
      current.map((q, i) =>
        i === qi ? { ...q, options: q.options.map((o, j) => (j === oi ? value : o)) } : q
      )
    )
  }

  async function handleSave(approve: boolean) {
    setBusy(true)
    setError(null)
    try {
      await saveRecallQuestions(sessionId, questions, approve)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm text-gray-600">
          Attendees get these as retention practice; absentees can pass them
          (2 of 3) to record caught-up attendance. Check every answer before
          approving.
        </p>
        <Badge variant={initialSet.status === 'approved' ? 'success' : 'warning'}>
          {initialSet.status}
        </Badge>
      </div>

      {error && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {questions.map((q, qi) => (
          <div key={qi} className="border border-black p-4">
            <label className="font-mono text-xs font-bold uppercase tracking-wider">
              Question {qi + 1}
              <textarea
                value={q.question}
                onChange={(e) => updateQuestion(qi, { question: e.target.value })}
                rows={2}
                className="mt-1 w-full border border-black px-3 py-2 font-mono text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-clay-600"
              />
            </label>
            <div className="mt-3 space-y-2">
              {q.options.map((option, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`correct-${qi}`}
                    checked={q.answer_index === oi}
                    onChange={() => updateQuestion(qi, { answer_index: oi })}
                    aria-label={`Mark option ${oi + 1} correct`}
                  />
                  <input
                    type="text"
                    value={option}
                    onChange={(e) => updateOption(qi, oi, e.target.value)}
                    className="min-w-0 flex-1 border border-black px-3 py-1.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-clay-600"
                  />
                </div>
              ))}
            </div>
            <label className="mt-3 block font-mono text-xs font-bold uppercase tracking-wider">
              Explanation (shown after answering)
              <textarea
                value={q.explanation}
                onChange={(e) => updateQuestion(qi, { explanation: e.target.value })}
                rows={2}
                className="mt-1 w-full border border-black px-3 py-2 font-mono text-sm font-normal normal-case tracking-normal focus:outline-none focus:ring-2 focus:ring-clay-600"
              />
            </label>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => handleSave(true)} disabled={busy}>
          {busy ? 'Saving…' : initialSet.status === 'approved' ? 'Save changes' : 'Approve & enable'}
        </Button>
        {initialSet.status !== 'approved' && (
          <Button variant="secondary" onClick={() => handleSave(false)} disabled={busy}>
            Save draft
          </Button>
        )}
      </div>
    </div>
  )
}
