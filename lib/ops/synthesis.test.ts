import { describe, expect, it } from 'vitest'
import {
  SynthesisSchema,
  buildSynthesisPrompt,
  extractFeedbackTexts,
  sanitizeSynthesis,
} from './synthesis'

const validOutput = {
  themes: [{ title: 'Clear structure', detail: 'Responses praised the case-based format', count: 4 }],
  sentiment: 'positive' as const,
  suggestions: ['Share slides beforehand'],
  quotes: ['really engaging cases'],
  requires_human_review: false,
}

describe('SynthesisSchema', () => {
  it('accepts a well-formed synthesis', () => {
    expect(SynthesisSchema.safeParse(validOutput).success).toBe(true)
  })

  it('rejects unknown sentiment and oversized arrays', () => {
    expect(SynthesisSchema.safeParse({ ...validOutput, sentiment: 'glowing' }).success).toBe(false)
    expect(
      SynthesisSchema.safeParse({
        ...validOutput,
        themes: Array.from({ length: 6 }, () => validOutput.themes[0]),
      }).success
    ).toBe(false)
  })

  it('rejects missing requires_human_review', () => {
    const { requires_human_review: _omit, ...rest } = validOutput
    expect(SynthesisSchema.safeParse(rest).success).toBe(false)
  })
})

describe('sanitizeSynthesis', () => {
  it('strips known names from every text field', () => {
    const out = sanitizeSynthesis(
      {
        ...validOutput,
        themes: [{ title: 'Praise for Jane Doe', detail: 'Jane Doe explained well' }],
        quotes: ['Jane Doe was brilliant'],
        suggestions: ['Ask Jane Doe to run it again'],
      },
      ['Jane Doe'],
      false
    )
    const all = JSON.stringify(out)
    expect(all).not.toMatch(/jane/i)
    expect(all).toContain('[name]')
  })

  it('drops quotes containing welfare signals', () => {
    const out = sanitizeSynthesis(
      { ...validOutput, quotes: ['felt bullied on the ward', 'great pacing'] },
      [],
      false
    )
    expect(out.quotes).toEqual(['great pacing'])
  })

  it('forces requires_human_review when the deterministic pre-check fired', () => {
    const out = sanitizeSynthesis({ ...validOutput, requires_human_review: false }, [], true)
    expect(out.requires_human_review).toBe(true)
  })
})

describe('extractFeedbackTexts', () => {
  it('collects comment plus non-rating answer values and comments', () => {
    const texts = extractFeedbackTexts({
      comment: 'overall solid',
      answers: [
        { fieldId: '1', type: 'rating', label: 'Rating', value: '5', commentLabel: null, comment: 'well paced' },
        { fieldId: '2', type: 'textarea', label: 'Improve?', value: 'more cases', commentLabel: null, comment: null },
      ],
    })
    expect(texts).toEqual(['overall solid', 'well paced', 'more cases'])
  })

  it('handles null comment and malformed answers', () => {
    expect(extractFeedbackTexts({ comment: null, answers: 'garbage' })).toEqual([])
  })
})

describe('buildSynthesisPrompt', () => {
  it('fences feedback as data and numbers responses', () => {
    const prompt = buildSynthesisPrompt({
      sessionTitle: 'Sepsis update',
      items: [
        { rating: 5, texts: ['great'] },
        { rating: null, texts: [] },
      ],
    })
    expect(prompt).toContain('<feedback>')
    expect(prompt).toContain('--- Response 1 ---')
    expect(prompt).toContain('Rating: none')
    expect(prompt).toContain('(no written feedback)')
  })
})
