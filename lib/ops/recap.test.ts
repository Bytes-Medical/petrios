import { describe, expect, it } from 'vitest'
import {
  AUDIO_RECAP_MAX_SCRIPT_CHARS,
  AUDIO_RECAP_RESEARCH_DOMAINS,
  RECAP_SYSTEM,
  buildRecapPrompt,
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
