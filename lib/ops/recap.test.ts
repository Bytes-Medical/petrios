import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmResult } from '@/lib/ai/llm'

const { opsInferenceMock } = vi.hoisted(() => ({ opsInferenceMock: vi.fn() }))
vi.mock('./gateway', () => ({ opsInference: opsInferenceMock }))

import {
  AUDIO_RECAP_MAX_SCRIPT_CHARS,
  AUDIO_RECAP_RESEARCH_DOMAINS,
  RECAP_SYSTEM,
  buildRecapPrompt,
  generateRecapScript,
} from './recap'

describe('buildRecapPrompt', () => {
  it('uses uploaded learning documents instead of metadata or feedback', () => {
    const prompt = buildRecapPrompt({
      sessionTitle: 'Managing acute asthma',
      documents: [{
        id: 'document-1',
        filename: 'asthma-teaching.pdf',
        mimeType: 'application/pdf',
        byteSize: 1234,
        sha256: 'a'.repeat(64),
      }],
    })
    expect(prompt).toContain('Managing acute asthma')
    expect(prompt).toContain('asthma-teaching.pdf (application/pdf, 1234 bytes)')
    expect(prompt).toContain('Attached learning documents')
    expect(prompt).toContain('approximately five-minute')
    expect(prompt).toContain('primary focus')
    expect(prompt).not.toContain('Description:')
    expect(prompt).not.toContain('feedback')
  })

  it('exports a sane script cap', () => {
    expect(AUDIO_RECAP_MAX_SCRIPT_CHARS).toBeGreaterThan(500)
    expect(AUDIO_RECAP_MAX_SCRIPT_CHARS).toBeLessThanOrEqual(10000)
  })

  it('keeps documents primary while requiring detailed, safe research context', () => {
    expect(RECAP_SYSTEM).toContain('650 to 800 words')
    expect(RECAP_SYSTEM).toContain('primary evidence')
    expect(RECAP_SYSTEM).toContain('Use hosted web research only to supplement')
    expect(RECAP_SYSTEM).toContain('Do not give patient-specific medical advice')
    expect(AUDIO_RECAP_RESEARCH_DOMAINS).toContain('nice.org.uk')
    expect(AUDIO_RECAP_RESEARCH_DOMAINS).toContain('nhs.uk')
  })
})

describe('generateRecapScript', () => {
  const documents = [{
    id: 'document-1',
    filename: 'asthma-teaching.pdf',
    mimeType: 'application/pdf',
    byteSize: 1234,
    sha256: 'a'.repeat(64),
  }]
  const files = [{
    filename: 'asthma-teaching.pdf',
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    open: async () => new ReadableStream<Uint8Array>(),
  }]
  const served = (overrides: Partial<LlmResult>): LlmResult => ({
    text: ' A spoken recap. ',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'claude-opus-5',
    sources: [{ url: 'https://www.nice.org.uk/guidance/ng80', title: 'NICE NG80' }],
    webSearchRequests: 2,
    ...overrides,
  })
  const answer = (result: LlmResult | null) => {
    opsInferenceMock.mockImplementation(async (input: { onResult?: (value: LlmResult) => void }) => {
      if (!result) return null
      input.onResult?.(result)
      return result.text
    })
  }

  beforeEach(() => {
    opsInferenceMock.mockReset()
  })

  it('requires bounded research through the gateway and returns the served model', async () => {
    answer(served({}))
    await expect(generateRecapScript({ sessionTitle: 'Asthma', documents, files })).resolves.toEqual({
      script: 'A spoken recap.',
      researchSources: [{ url: 'https://www.nice.org.uk/guidance/ng80', title: 'NICE NG80' }],
      model: 'claude-opus-5',
    })
    expect(opsInferenceMock).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'audio_recap',
      files,
      webSearch: {
        allowedDomains: [...AUDIO_RECAP_RESEARCH_DOMAINS],
        searchContextSize: 'medium',
        maxUses: 6,
        userLocation: { country: 'GB' },
        required: true,
      },
    }))
  })

  it('rejects a draft when no search ran, even if sources were returned', async () => {
    answer(served({ webSearchRequests: 0 }))
    await expect(generateRecapScript({ sessionTitle: 'Asthma', documents, files }))
      .rejects.toThrow('did not return any verifiable research sources')
  })

  it('rejects a draft without research sources', async () => {
    answer(served({ sources: [] }))
    await expect(generateRecapScript({ sessionTitle: 'Asthma', documents, files }))
      .rejects.toThrow('did not return any verifiable research sources')
  })

  it('returns null when the gateway skips the item', async () => {
    answer(null)
    await expect(generateRecapScript({ sessionTitle: 'Asthma', documents, files })).resolves.toBeNull()
  })
})
