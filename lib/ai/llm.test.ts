import { afterEach, describe, expect, it, vi } from 'vitest'
import { askLlmWithFileInputs } from './llm'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Responses file-input adapter', () => {
  it('sends private document bytes as file inputs and reads output text', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'test-model',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'A document-grounded recap.' }],
        }],
        usage: { input_tokens: 123, output_tokens: 45 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await askLlmWithFileInputs({
      system: 'Use only the files.',
      prompt: 'Create the recap.',
      maxTokens: 900,
      files: [
        {
          filename: 'handout.pdf',
          mimeType: 'application/pdf',
          bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
          sha256: 'a'.repeat(64),
        },
        {
          filename: 'slides.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
          sha256: 'b'.repeat(64),
        },
      ],
    })

    expect(result?.text).toBe('A document-grounded recap.')
    expect(result?.usage).toEqual({ inputTokens: 123, outputTokens: 45 })
    expect(result?.sources).toEqual([])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/responses$/)
    const body = JSON.parse(String(init.body))
    expect(body.instructions).toBe('Use only the files.')
    expect(body.max_output_tokens).toBe(900)
    expect(body.input[0].content).toEqual([
      expect.objectContaining({
        type: 'input_file',
        filename: 'handout.pdf',
        file_data: 'data:application/pdf;base64,JVBERg==',
        detail: 'auto',
      }),
      expect.objectContaining({
        type: 'input_file',
        filename: 'slides.pptx',
        file_data: 'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,UEsDBA==',
      }),
      { type: 'input_text', text: 'Create the recap.' },
    ])
    expect(body.input[0].content[1]).not.toHaveProperty('detail')
  })

  it('requires bounded hosted search and returns de-duplicated clickable sources', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [
          {
            type: 'web_search_call',
            action: {
              sources: [
                { url: 'https://www.nice.org.uk/guidance/ng80', title: 'NICE guidance' },
                { url: 'javascript:alert(1)', title: 'Unsafe' },
              ],
            },
          },
          {
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'A researched recap.',
              annotations: [{
                type: 'url_citation',
                url: 'https://www.nice.org.uk/guidance/ng80',
                title: 'Duplicate citation',
              }],
            }],
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await askLlmWithFileInputs({
      system: 'Documents lead; research supplements.',
      prompt: 'Create the recap.',
      files: [{
        filename: 'handout.pdf',
        mimeType: 'application/pdf',
        bytes: new Uint8Array([1]),
        sha256: 'a'.repeat(64),
      }],
      webSearch: {
        allowedDomains: ['nice.org.uk', 'nhs.uk'],
        searchContextSize: 'medium',
        userLocation: { country: 'GB' },
        required: true,
      },
    })

    expect(result?.sources).toEqual([{
      url: 'https://www.nice.org.uk/guidance/ng80',
      title: 'NICE guidance',
    }])
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.tools).toEqual([expect.objectContaining({
      type: 'web_search',
      search_context_size: 'medium',
      external_web_access: true,
      filters: { allowed_domains: ['nice.org.uk', 'nhs.uk'] },
      user_location: { type: 'approximate', country: 'GB' },
    })])
    expect(body.tool_choice).toBe('required')
    expect(body.include).toEqual(['web_search_call.action.sources'])
  })
})
