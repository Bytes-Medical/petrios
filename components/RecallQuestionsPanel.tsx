'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recallPublishedQuestions, saveRecallQuestions } from '@/app/actions/recall'
import type { RecallQuestionSet } from '@/lib/db/recall'
import type { RecallQuestion } from '@/lib/recall'
import { Badge } from './Badge'
import { Button } from './Button'

interface RecallQuestionsPanelProps {
  sessionId: string
  initialSet: RecallQuestionSet | null
  recapScriptDigest?: string | null
}

/**
 * Moderator review of AI-drafted recall questions. Nothing is emailed until
 * a moderator has (optionally edited and) APPROVED the set here — this is
 * the human gate on AI-generated content, and it also enables catch-up
 * attendance for absentees.
 */
export function RecallQuestionsPanel({
  sessionId,
  initialSet,
  recapScriptDigest,
}: RecallQuestionsPanelProps) {
  const router = useRouter()
  const [questions, setQuestions] = useState<RecallQuestion[]>(initialSet?.questions ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!initialSet) {
    return (
      <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
        No question set drafted yet. Generate or regenerate the Audio Recap to
        draft five questions from its spoken script.
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

  async function handleRecall() {
    if (!window.confirm('Recall these questions? Learner access stops until you publish them again.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await recallPublishedQuestions(sessionId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to recall questions')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="group border border-black bg-white">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 marker:content-none">
        <span className="font-mono text-sm font-bold">
          Generated questions
          <span className="ml-2 font-normal text-gray-500">
            {questions.length} questions · revision {initialSet.revision}
          </span>
        </span>
        <span className="flex items-center gap-3">
          <Badge variant={initialSet.status === 'approved' ? 'success' : 'warning'}>
            {initialSet.status}
          </Badge>
          <span
            aria-hidden="true"
            className="font-mono text-lg transition-transform group-open:rotate-45"
          >
            +
          </span>
        </span>
      </summary>

      <div className="space-y-4 border-t border-black p-4">
        <p className="font-mono text-sm text-gray-600">
          Registered absentees complete the approved audio and must answer all
          five questions correctly. Check every answer before publishing.
        </p>

        {initialSet.status === 'approved' && initialSet.catchup_closes_at && (
          <div className="border border-green-800 bg-green-50 px-3 py-2 font-mono text-xs text-green-900">
            Published revision {initialSet.revision}. Registered finalized absentees
            can complete this pathway until{' '}
            <strong>
              {new Date(initialSet.catchup_closes_at).toLocaleString('en-GB')}
            </strong>.
          </div>
        )}

        {initialSet.script_digest !== recapScriptDigest && (
          <p className="border border-amber-700 bg-amber-50 px-3 py-2 font-mono text-xs text-amber-900">
            These questions do not match the current recap script. Regenerate the
            Audio Recap questions before publishing.
          </p>
        )}

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
                  disabled={initialSet.status === 'approved'}
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
                      disabled={initialSet.status === 'approved'}
                      name={`correct-${qi}`}
                      checked={q.answer_index === oi}
                      onChange={() => updateQuestion(qi, { answer_index: oi })}
                      aria-label={`Mark option ${oi + 1} correct`}
                    />
                    <input
                      type="text"
                      disabled={initialSet.status === 'approved'}
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
                  disabled={initialSet.status === 'approved'}
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
          {initialSet.status === 'approved' ? (
            <Button variant="secondary" onClick={handleRecall} disabled={busy}>
              {busy ? 'Recalling…' : 'Recall for editing'}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => handleSave(true)}
                disabled={busy || initialSet.script_digest !== recapScriptDigest}
              >
                {busy ? 'Saving…' : 'Approve & publish catch-up'}
              </Button>
              <Button variant="secondary" onClick={() => handleSave(false)} disabled={busy}>
                Save draft
              </Button>
            </>
          )}
        </div>
      </div>
    </details>
  )
}
