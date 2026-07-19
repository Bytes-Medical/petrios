import { describe, expect, it } from 'vitest'
import { extractJson, hashPrompt, opsInference } from './gateway'

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
  it('rejects private files for non-recap inference purposes', async () => {
    await expect(
      opsInference({
        purpose: 'assistant',
        system: 'system',
        prompt: 'prompt',
        files: [{
          filename: 'private.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array([1]),
          sha256: 'a'.repeat(64),
        }],
      })
    ).rejects.toThrow('allowed only for the audio_recap purpose')
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
