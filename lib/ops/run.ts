import * as opsDb from '@/lib/db/ops'

/**
 * Audit-run helper: one OpsRun per cron invocation or chat turn. Steps are
 * numbered in order and logging is best-effort — a failed audit insert must
 * never take down the work being audited.
 */
export interface OpsRun {
  id: string
  log(name: string, detail?: Record<string, unknown>): Promise<void>
  logLlm(input: {
    name: string
    purpose: string
    model: string
    promptHash: string
    inputTokens?: number | null
    outputTokens?: number | null
    detail?: Record<string, unknown>
  }): Promise<void>
  finish(status: 'succeeded' | 'failed', summary?: string): Promise<void>
}

export async function startRun(
  kind: string,
  trigger: string,
  orgId?: string | null
): Promise<OpsRun> {
  const id = await opsDb.insertAgentRun({ kind, trigger, orgId: orgId ?? null })
  let seq = 0

  return {
    id,
    async log(name, detail) {
      seq += 1
      try {
        await opsDb.insertAgentRunStep({ runId: id, seq, name, detail: detail ?? null })
      } catch (err) {
        console.error(`Failed to log ops run step "${name}":`, err)
      }
    },
    async logLlm(input) {
      seq += 1
      try {
        await opsDb.insertAgentRunStep({
          runId: id,
          seq,
          name: input.name,
          detail: input.detail ?? null,
          purpose: input.purpose,
          model: input.model,
          promptHash: input.promptHash,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
        })
      } catch (err) {
        console.error(`Failed to log ops LLM step "${input.name}":`, err)
      }
    },
    async finish(status, summary) {
      try {
        await opsDb.finishAgentRun(id, status, summary)
      } catch (err) {
        console.error('Failed to finish ops run:', err)
      }
    },
  }
}
