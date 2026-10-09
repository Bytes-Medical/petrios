import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Anthropic Files API orphan sweep must run on every ops-synthesis pass,
// including one whose synthesis work (or audit run) failed. Everything the
// route touches is mocked; no database or provider is reached.

const state = vi.hoisted(() => ({
  provider: 'anthropic' as 'anthropic' | 'openai' | null,
  startRunFails: false,
  listFails: false,
  sweepFails: false,
  sweeps: 0,
  run: {
    id: 'run-1',
    log: vi.fn(async () => {}),
    logLlm: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
  },
}))

vi.mock('@/lib/cron-auth', () => ({ unauthorizedCronResponse: () => null }))
vi.mock('@/lib/ops/flags', () => ({ opsEnabled: () => true }))
vi.mock('@/lib/ops/run', () => ({
  startRun: async () => {
    if (state.startRunFails) throw new Error('ops_agent_runs insert failed')
    return state.run
  },
}))
vi.mock('@/lib/ai/llm', () => ({
  activeLlmProvider: () => state.provider,
  describeLlmError: (err: unknown) => `Described: ${err instanceof Error ? err.message : 'unknown'}`,
}))
vi.mock('@/lib/ai/anthropic-files', () => ({
  sweepAnthropicFiles: async () => {
    state.sweeps += 1
    if (state.sweepFails) throw new Error('files list failed')
    return { scanned: 3, deleted: 2, failed: 0 }
  },
}))
vi.mock('@/lib/db/ops-reads', () => ({
  listSessionsEndedBetween: async () => {
    if (state.listFails) throw new Error('database unavailable')
    return []
  },
  listDepartmentModeratorUserIds: async () => [],
}))
vi.mock('@/lib/db/ops', () => ({
  listSynthesizedSessionIds: async () => new Set<string>(),
  insertPendingAction: async () => undefined,
}))
vi.mock('@/lib/db/audit', () => ({ listFeedbackRatingsForSessions: async () => [] }))
vi.mock('@/lib/db/recall', () => ({ listSessionIdsWithSets: async () => new Set<string>() }))
vi.mock('@/lib/db/feedback', () => ({ listAcceptedTeacherInvitations: async () => [] }))
vi.mock('@/lib/db/sessions', () => ({ listAcceptedSessionTeacherUserIdsAsSystem: async () => [] }))
vi.mock('@/lib/db/onboarding', () => ({ listProfilesForUsers: async () => [] }))
vi.mock('@/lib/notify', () => ({ notifyUser: async () => undefined }))
vi.mock('@/lib/ops/synthesis', () => ({ runSynthesisForSession: async () => null }))
vi.mock('@/lib/ops/recall', () => ({ draftRecallQuestions: async () => false }))
vi.mock('@/lib/ops/format', () => ({ formatDateLong: () => '' }))
vi.mock('@/lib/ops/drafts', () => ({ draftThankYouEmail: async () => ({ subject: '', body: '' }) }))
vi.mock('@/lib/ops/email-html', () => ({ buildOpsEmailHtml: () => '' }))
vi.mock('@/lib/contacts', () => ({ profileDisplayName: () => '' }))

import { GET } from './route'

const request = () => new NextRequest('https://petrios.test/api/cron/ops-synthesis')

beforeEach(() => {
  state.provider = 'anthropic'
  state.startRunFails = false
  state.listFails = false
  state.sweepFails = false
  state.sweeps = 0
  state.run.log.mockClear()
  state.run.finish.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('ops-synthesis Files API sweep', () => {
  it('sweeps before finishing a successful run', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(state.sweeps).toBe(1)
    expect(state.run.log).toHaveBeenCalledWith('files:sweep', { scanned: 3, deleted: 2, failed: 0 })
    expect(state.run.finish).toHaveBeenCalledWith('succeeded', expect.any(String))
  })

  it('still sweeps when the synthesis work throws', async () => {
    state.listFails = true
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(state.sweeps).toBe(1)
    expect(state.run.log).toHaveBeenCalledWith('files:sweep', { scanned: 3, deleted: 2, failed: 0 })
    expect(state.run.finish).toHaveBeenCalledWith('failed', 'database unavailable')
  })

  it('still sweeps when the audit run cannot be started', async () => {
    state.startRunFails = true
    const response = await GET(request())
    expect(response.status).toBe(500)
    expect(state.sweeps).toBe(1)
    expect(console.warn).toHaveBeenCalledWith('[ai] Anthropic file sweep: 2 deleted, 0 failed')
  })

  it('records a sweep failure without failing an otherwise successful run', async () => {
    state.sweepFails = true
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(state.run.log).toHaveBeenCalledWith('files:sweep:error', { error: 'Described: files list failed' })
    expect(state.run.finish).toHaveBeenCalledWith('succeeded', expect.any(String))
  })

  it('does not sweep unless Anthropic is the active provider', async () => {
    for (const provider of ['openai', null] as const) {
      state.provider = provider
      state.listFails = provider === null
      await GET(request())
    }
    expect(state.sweeps).toBe(0)
  })
})
