import { describe, expect, it } from 'vitest'
import { AUDIO_RECAP_MAX_SCRIPT_CHARS, buildRecapPrompt } from './recap'

describe('buildRecapPrompt', () => {
  it('includes the session title, description, and tags', () => {
    const prompt = buildRecapPrompt({
      sessionTitle: 'Managing acute asthma',
      description: 'Stepwise approach to the acutely wheezy child.',
      tags: ['respiratory', 'acute'],
      synthesis: null,
    })
    expect(prompt).toContain('Managing acute asthma')
    expect(prompt).toContain('Stepwise approach')
    expect(prompt).toContain('respiratory, acute')
  })

  it('renders missing description and tags as (none)', () => {
    const prompt = buildRecapPrompt({
      sessionTitle: 'T',
      description: null,
      tags: null,
      synthesis: null,
    })
    expect(prompt).toContain('Description: (none)')
    expect(prompt).toContain('Tags: (none)')
  })

  it('fences synthesis content as untrusted data', () => {
    const prompt = buildRecapPrompt({
      sessionTitle: 'T',
      description: null,
      tags: null,
      synthesis: {
        themes: [{ title: 'Pacing', detail: 'Final section felt rushed' }],
        suggestions: ['More case examples'],
      },
    })
    expect(prompt).toContain('<feedback_themes>')
    expect(prompt).toContain('</feedback_themes>')
    expect(prompt).toContain('untrusted data')
    expect(prompt).toContain('Pacing: Final section felt rushed')
    expect(prompt).toContain('Suggestion: More case examples')
    // fenced content comes before the closing tag
    expect(prompt.indexOf('Pacing')).toBeGreaterThan(prompt.indexOf('<feedback_themes>'))
    expect(prompt.indexOf('Pacing')).toBeLessThan(prompt.indexOf('</feedback_themes>'))
  })

  it('omits the fence entirely when there is no synthesis content', () => {
    const empty = buildRecapPrompt({
      sessionTitle: 'T',
      description: null,
      tags: null,
      synthesis: { themes: [], suggestions: [] },
    })
    expect(empty).not.toContain('<feedback_themes>')
    const none = buildRecapPrompt({
      sessionTitle: 'T',
      description: null,
      tags: null,
      synthesis: null,
    })
    expect(none).not.toContain('<feedback_themes>')
  })

  it('exports a sane script cap', () => {
    expect(AUDIO_RECAP_MAX_SCRIPT_CHARS).toBeGreaterThan(500)
    expect(AUDIO_RECAP_MAX_SCRIPT_CHARS).toBeLessThanOrEqual(5000)
  })
})
