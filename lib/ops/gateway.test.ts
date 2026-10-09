import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const llm = vi.hoisted(() => ({
  askLlmWithUsage: vi.fn(),
  askLlmWithFileInputs: vi.fn(),
  isLlmConfigured: vi.fn(() => true),
  llmModel: vi.fn(() => 'claude-opus-5-5'),
  describeLlmError: vi.fn((err: unknown) => `DescribedError: ${err instanceof Error ? err.name : 'unknown'}`),
}))

// The provider adapters are implementer A's (lib/ai/llm.ts); the gateway is
// tested against the provider-neutral contract only.
vi.mock('@/lib/ai/llm', () => llm)

import { extractJson, hashPrompt, opsInference, OPS_PURPOSE_EFFORT, type OpsPurpose } from './gateway'
import type { OpsRun } from './run'
import type { LlmWebSearchOptions } from '@/lib/ai/llm'

const SYSTEM = 'SYSTEM-PROMPT-TEXT names: Dr Example'
const PROMPT = 'PROMPT-TEXT with feedback from Jane Trainee'

function fakeRun() {
  return {
    id: 'run-1',
    log: vi.fn<OpsRun['log']>(async () => {}),
    logLlm: vi.fn<OpsRun['logLlm']>(async () => {}),
    finish: vi.fn<OpsRun['finish']>(async () => {}),
  } satisfies OpsRun
}

function llmResult(text: string, model = 'claude-opus-5-5') {
  return {
    text,
    usage: { inputTokens: 120, outputTokens: 30 },
    model,
    sources: [],
    webSearchRequests: 0,
  }
}

const pdf = {
  filename: 'handout.pdf',
  mimeType: 'application/pdf' as const,
  open: async () => new ReadableStream<Uint8Array>(),
  sha256: 'a'.repeat(64),
}

beforeEach(() => {
  vi.stubEnv('OPS_ENABLED', '')
  llm.askLlmWithUsage.mockReset()
  llm.askLlmWithFileInputs.mockReset()
  llm.isLlmConfigured.mockReset().mockReturnValue(true)
  llm.llmModel.mockClear()
  llm.describeLlmError.mockClear()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('extractJson', () => {
  it('extracts a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })

  it('extracts JSON from markdown fences and surrounding prose', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nDone.')).toBe('{"a":1}')
  })

  it('extracts arrays', () => {
    expect(extractJson('result: [1,2,3] ok')).toBe('[1,2,3]')
  })

  it('returns null when no JSON is present', () => {
    expect(extractJson('no structured data here')).toBeNull()
  })
})

describe('hashPrompt', () => {
  it('is stable and input-sensitive', () => {
    expect(hashPrompt('sys', 'prompt')).toBe(hashPrompt('sys', 'prompt'))
    expect(hashPrompt('sys', 'prompt')).not.toBe(hashPrompt('sys', 'prompt2'))
    expect(hashPrompt('sys', 'prompt')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('file-input purpose gate', () => {
  it('rejects private files outside recap and newsletter inference', async () => {
    await expect(
      opsInference({
        purpose: 'assistant',
        system: 'system',
        prompt: 'prompt',
        files: [pdf],
      })
    ).rejects.toThrow('allowed only for audio recap or newsletter generation')
  })

  it('rejects hosted web search for non-recap inference purposes', async () => {
    await expect(
      opsInference({
        purpose: 'assistant',
        system: 'system',
        prompt: 'prompt',
        webSearch: { allowedDomains: ['nice.org.uk'], required: true },
      })
    ).rejects.toThrow('Hosted web search is allowed only for the audio_recap purpose')
  })
})

describe('opsInference gating', () => {
  it('throws when Ops is disabled and never reaches the provider', async () => {
    vi.stubEnv('OPS_ENABLED', 'false')
    await expect(opsInference({ purpose: 'email_draft', system: SYSTEM, prompt: PROMPT })).rejects.toThrow(
      'Petrios Ops is disabled'
    )
    expect(llm.askLlmWithUsage).not.toHaveBeenCalled()
  })

  it('rejects purposes outside the allow-list', async () => {
    await expect(
      opsInference({ purpose: 'free_chat' as OpsPurpose, system: SYSTEM, prompt: PROMPT })
    ).rejects.toThrow('Unknown ops inference purpose: free_chat')
  })

  it('returns null without a provider call when no LLM is configured', async () => {
    llm.isLlmConfigured.mockReturnValue(false)
    const run = fakeRun()
    expect(await opsInference({ purpose: 'email_draft', system: SYSTEM, prompt: PROMPT, run })).toBeNull()
    expect(llm.askLlmWithUsage).not.toHaveBeenCalled()
    expect(run.logLlm).not.toHaveBeenCalled()
  })
})

describe('opsInference effort', () => {
  it('sets an explicit effort for every purpose', () => {
    expect(OPS_PURPOSE_EFFORT).toEqual({
      feedback_synthesis: 'medium',
      email_draft: 'low',
      newsletter: 'medium',
      low_score_digest: 'low',
      recall_questions: 'medium',
      audio_recap: 'high',
      assistant: 'medium',
    })
  })

  it.each([
    ['feedback_synthesis', 'medium'],
    ['email_draft', 'low'],
    ['low_score_digest', 'low'],
    ['recall_questions', 'medium'],
  ] as const)('passes the %s default effort (%s) as defaultEffort, leaving effort to the caller', async (purpose, effort) => {
    llm.askLlmWithUsage.mockResolvedValue(llmResult('ok'))
    await opsInference({ purpose, system: SYSTEM, prompt: PROMPT, maxTokens: 900 })
    expect(llm.askLlmWithUsage).toHaveBeenCalledWith({
      system: SYSTEM,
      prompt: PROMPT,
      maxTokens: 900,
      effort: undefined,
      defaultEffort: effort,
      jsonMode: false,
    })
  })

  it('passes an explicit caller effort through unchanged', async () => {
    llm.askLlmWithUsage.mockResolvedValue(llmResult('ok'))
    await opsInference({ purpose: 'email_draft', system: SYSTEM, prompt: PROMPT, effort: 'high' })
    expect(llm.askLlmWithUsage.mock.calls[0][0]).toMatchObject({ effort: 'high', defaultEffort: 'low' })
  })

  it.each<[OpsPurpose, string, LlmWebSearchOptions | undefined]>([
    ['newsletter', 'medium', undefined],
    ['audio_recap', 'high', { allowedDomains: ['nice.org.uk'], required: true, maxUses: 6 }],
  ])('sends file-backed %s calls with defaultEffort %s', async (purpose, effort, webSearch) => {
    llm.askLlmWithFileInputs.mockResolvedValue(llmResult('script'))
    await opsInference({ purpose, system: SYSTEM, prompt: PROMPT, files: [pdf], webSearch })
    expect(llm.askLlmWithUsage).not.toHaveBeenCalled()
    expect(llm.askLlmWithFileInputs).toHaveBeenCalledWith({
      system: SYSTEM,
      prompt: PROMPT,
      files: [pdf],
      maxTokens: undefined,
      effort: undefined,
      defaultEffort: effort,
      webSearch,
    })
  })
})

describe('opsInference audit', () => {
  it('records the served model, a prompt hash and token counts, never prompt text', async () => {
    const result = llmResult('drafted', 'claude-opus-5')
    llm.askLlmWithUsage.mockResolvedValue(result)
    const run = fakeRun()
    const onResult = vi.fn()

    const text = await opsInference({
      purpose: 'email_draft',
      system: SYSTEM,
      prompt: PROMPT,
      run,
      stepName: 'draft:1',
      onResult,
    })

    expect(text).toBe('drafted')
    expect(onResult).toHaveBeenCalledWith(result)
    expect(run.logLlm).toHaveBeenCalledTimes(1)
    expect(run.logLlm).toHaveBeenCalledWith({
      name: 'draft:1',
      purpose: 'email_draft',
      model: 'claude-opus-5',
      promptHash: hashPrompt(SYSTEM, PROMPT),
      inputTokens: 120,
      outputTokens: 30,
    })
    const audited = JSON.stringify([run.logLlm.mock.calls, run.log.mock.calls])
    expect(audited).not.toContain('PROMPT-TEXT')
    expect(audited).not.toContain('SYSTEM-PROMPT-TEXT')
    expect(audited).not.toContain('drafted')
  })

  it('fingerprints file and research inputs into the hash, never their contents', async () => {
    llm.askLlmWithFileInputs.mockResolvedValue(llmResult('script'))
    const run = fakeRun()
    const webSearch = { allowedDomains: ['nice.org.uk'], required: true, maxUses: 6 }
    await opsInference({ purpose: 'audio_recap', system: SYSTEM, prompt: PROMPT, files: [pdf], webSearch, run })
    expect(run.logLlm.mock.calls[0][0]).toMatchObject({
      promptHash: hashPrompt(
        SYSTEM,
        `${PROMPT}\nfiles:\nhandout.pdf:${pdf.sha256}\nweb_search:${JSON.stringify(webSearch)}`
      ),
    })
  })

  it('audits a provider failure with the described error and the configured model, then skips', async () => {
    const failure = new Error('provider said no')
    llm.askLlmWithUsage.mockRejectedValue(failure)
    const run = fakeRun()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await opsInference({ purpose: 'feedback_synthesis', system: SYSTEM, prompt: PROMPT, run })).toBeNull()

    expect(llm.describeLlmError).toHaveBeenCalledWith(failure)
    expect(run.logLlm).toHaveBeenCalledWith({
      name: 'llm:feedback_synthesis:error',
      purpose: 'feedback_synthesis',
      model: 'claude-opus-5-5',
      promptHash: hashPrompt(SYSTEM, PROMPT),
      detail: { error: 'DescribedError: Error' },
    })
    expect(consoleError).toHaveBeenCalledWith('Ops inference failed (feedback_synthesis): DescribedError: Error')
    expect(JSON.stringify(run.logLlm.mock.calls)).not.toContain('PROMPT-TEXT')
  })

  it('retries invalid JSON once and audits both attempts', async () => {
    const schema = z.object({ ok: z.boolean() })
    llm.askLlmWithUsage
      .mockResolvedValueOnce(llmResult('not json', 'claude-opus-5-5'))
      .mockResolvedValueOnce(llmResult('{"ok":true}', 'claude-opus-5'))
    const run = fakeRun()
    const models: string[] = []

    const value = await opsInference({
      purpose: 'recall_questions',
      system: SYSTEM,
      prompt: PROMPT,
      schema,
      run,
      stepName: 'recall:s1',
      onResult: (result) => models.push(result.model),
    })

    expect(value).toEqual({ ok: true })
    expect(models).toEqual(['claude-opus-5-5', 'claude-opus-5'])
    expect(llm.askLlmWithUsage).toHaveBeenCalledTimes(2)
    expect(llm.askLlmWithUsage.mock.calls[1][0]).toMatchObject({
      jsonMode: true,
      defaultEffort: 'medium',
    })
    expect(llm.askLlmWithUsage.mock.calls[1][0].prompt).toContain('Your previous response was invalid')
    expect(run.logLlm.mock.calls.map(([step]) => [step.name, step.model])).toEqual([
      ['recall:s1', 'claude-opus-5-5'],
      ['recall:s1:retry', 'claude-opus-5'],
    ])
  })
})
