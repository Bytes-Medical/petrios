'use server'

import { requireOpsManager } from '@/lib/ops/auth'
import { opsEnabled } from '@/lib/ops/flags'
import { startRun } from '@/lib/ops/run'
import { runAgentLoop, type ChatTurn } from '@/lib/ops/agent-loop'
import { OPS_TOOLS } from '@/lib/ops/tools'
import { ASSISTANT_SYSTEM_RULES, PLATFORM_KNOWLEDGE } from '@/lib/ops/knowledge'
import * as opsDb from '@/lib/db/ops'
import type { OpsChatMessage, OpsChatThread } from '@/lib/types'

/**
 * Organiser assistant chat. Organisers only (requireOrgManager); the model's
 * tools are bound to the caller's org — org scope never comes from model
 * input. History is persisted per thread in ops_chat_* tables.
 */

const HISTORY_LIMIT = 20

export async function listChatThreads(): Promise<OpsChatThread[]> {
  const { userId, orgId } = await requireOpsManager()
  return opsDb.listChatThreads(userId, orgId)
}

export async function getChatThread(
  threadId: string
): Promise<{ thread: OpsChatThread; messages: OpsChatMessage[] }> {
  const { userId } = await requireOpsManager()
  const thread = await opsDb.findChatThread(threadId, userId)
  if (!thread) throw new Error('Thread not found')
  const messages = await opsDb.listChatMessages(threadId)
  return { thread, messages }
}

export interface SendChatMessageResult {
  threadId: string
  reply: string
  toolSummary: { name: string; ok: boolean }[]
}

export async function sendChatMessage(
  threadId: string | null,
  text: string
): Promise<SendChatMessageResult> {
  const { userId, orgId } = await requireOpsManager()
  if (!opsEnabled()) {
    throw new Error('Petrios Ops is disabled (OPS_ENABLED=false) — the assistant is paused.')
  }

  const trimmed = text.trim()
  if (!trimmed) throw new Error('Message is empty')
  if (trimmed.length > 4000) throw new Error('Message is too long (4000 characters max)')

  let thread: OpsChatThread
  if (threadId) {
    const existing = await opsDb.findChatThread(threadId, userId)
    if (!existing) throw new Error('Thread not found')
    thread = existing
  } else {
    thread = await opsDb.insertChatThread({
      orgId,
      userId,
      title: trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed,
    })
  }

  const previous = await opsDb.listChatMessages(thread.id)
  const history: ChatTurn[] = previous
    .slice(-HISTORY_LIMIT)
    .map((m) => ({ role: m.role, content: m.content }))

  const run = await startRun('assistant_chat', 'chat', orgId)
  try {
    const result = await runAgentLoop({
      system: `${ASSISTANT_SYSTEM_RULES}\n\n${PLATFORM_KNOWLEDGE}`,
      history,
      userMessage: trimmed,
      tools: OPS_TOOLS,
      ctx: { orgId, userId, run },
      run,
    })

    await opsDb.insertChatMessage({ threadId: thread.id, role: 'user', content: trimmed })
    await opsDb.insertChatMessage({
      threadId: thread.id,
      role: 'assistant',
      content: result.text,
      toolSummary: result.toolTrace.length ? result.toolTrace : null,
    })
    await opsDb.touchChatThread(thread.id)
    await run.finish('succeeded', `${result.toolTrace.length} tool call(s)`)

    return { threadId: thread.id, reply: result.text, toolSummary: result.toolTrace }
  } catch (err) {
    await run.finish('failed', err instanceof Error ? err.message : 'chat failed')
    throw err instanceof Error ? err : new Error('The assistant hit an unexpected error')
  }
}
