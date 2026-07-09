'use client'

import { useState } from 'react'
import { getOpsRunSteps } from '@/app/actions/ops'
import { Badge } from '@/components/Badge'
import { Card } from '@/components/Card'
import type { OpsAgentRun, OpsAgentRunStep } from '@/lib/types'

interface RecentRunsPanelProps {
  runs: OpsAgentRun[]
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger'> = {
  succeeded: 'success',
  running: 'warning',
  failed: 'danger',
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Audit trail: what the agent did and when. Steps show purpose, model, and
 * token counts — prompt text is never stored, only its hash.
 */
export function RecentRunsPanel({ runs }: RecentRunsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Record<string, OpsAgentRunStep[]>>({})
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function toggle(runId: string) {
    if (expandedId === runId) {
      setExpandedId(null)
      return
    }
    setExpandedId(runId)
    if (!steps[runId]) {
      setLoadingId(runId)
      try {
        const result = await getOpsRunSteps(runId)
        setSteps((prev) => ({ ...prev, [runId]: result }))
      } catch {
        setSteps((prev) => ({ ...prev, [runId]: [] }))
      } finally {
        setLoadingId(null)
      }
    }
  }

  return (
    <Card>
      <h2 className="mb-1 font-mono text-xl font-bold">Recent agent runs</h2>
      <p className="mb-4 font-mono text-sm text-gray-600">
        Every automated pass is logged. LLM steps record the model, token
        counts, and a hash of the prompt — never the text itself.
      </p>

      {runs.length === 0 ? (
        <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
          No runs yet — they appear once the scheduled jobs start.
        </p>
      ) : (
        <div className="divide-y divide-gray-200 border border-gray-200">
          {runs.map((run) => {
            const expanded = expandedId === run.id
            return (
              <div key={run.id}>
                <button
                  type="button"
                  onClick={() => toggle(run.id)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs font-bold">{run.kind}</span>
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-gray-400">
                      {run.trigger} · {formatWhen(run.started_at)}
                    </span>
                    {run.summary && (
                      <span className="block truncate font-mono text-xs text-gray-600">
                        {run.summary}
                      </span>
                    )}
                  </span>
                  <Badge variant={STATUS_VARIANT[run.status]}>{run.status}</Badge>
                </button>
                {expanded && (
                  <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
                    {loadingId === run.id ? (
                      <p className="font-mono text-xs text-gray-500">Loading steps…</p>
                    ) : (steps[run.id]?.length ?? 0) === 0 ? (
                      <p className="font-mono text-xs text-gray-500">No steps recorded.</p>
                    ) : (
                      <ol className="space-y-1">
                        {steps[run.id].map((step) => (
                          <li key={step.id} className="font-mono text-xs">
                            <span className="text-gray-400">{step.seq}.</span>{' '}
                            <span className="font-bold">{step.name}</span>
                            {step.purpose && (
                              <span className="text-gray-600">
                                {' '}
                                — {step.purpose} · {step.model}
                                {step.input_tokens !== null &&
                                  ` · ${step.input_tokens}→${step.output_tokens} tokens`}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
