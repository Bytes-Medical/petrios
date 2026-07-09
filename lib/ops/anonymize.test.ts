import { describe, expect, it } from 'vitest'
import { containsWelfareSignal, stripNameLikeTokens } from './anonymize'

describe('stripNameLikeTokens', () => {
  it('replaces known names case-insensitively, full and partial', () => {
    const out = stripNameLikeTokens('jane doe was great, thanks Jane!', ['Jane Doe'])
    expect(out).not.toMatch(/jane/i)
    expect(out).not.toMatch(/doe/i)
    expect(out).toContain('[name]')
  })

  it('replaces honorific + surname patterns', () => {
    expect(stripNameLikeTokens('Dr Smith explained sepsis well')).toBe(
      '[name] explained sepsis well'
    )
    expect(stripNameLikeTokens('thanks to Prof. Jane Doe for the talk')).toBe(
      'thanks to [name] for the talk'
    )
  })

  it('replaces capitalised first-last pairs via the heuristic', () => {
    expect(stripNameLikeTokens('The session by Amara Okafor was clear')).toBe(
      'The session by [name] was clear'
    )
  })

  it('does not strip ordinary lowercase prose', () => {
    const text = 'the pacing was too fast and the slides were dense'
    expect(stripNameLikeTokens(text, ['Jane Doe'])).toBe(text)
  })

  it('collapses adjacent replacements', () => {
    const out = stripNameLikeTokens('Jane Doe and John Roe taught', ['Jane Doe', 'John Roe'])
    expect(out).not.toContain('[name] [name] [name]')
  })

  it('ignores short name fragments that would over-match', () => {
    // Two-letter parts like "Jo" must not strip inside other words.
    const out = stripNameLikeTokens('enjoyed the workshop', ['Jo Yu'])
    expect(out).toBe('enjoyed the workshop')
  })
})

describe('containsWelfareSignal', () => {
  it.each([
    'I felt bullied by the senior staff',
    'this was an unsafe environment',
    'ongoing harassment on the ward',
    'a patient safety incident occurred',
    'we should whistleblow about this',
    'I have been having suicidal thoughts',
    'blatant discrimination in allocations',
  ])('flags welfare content: %s', (text) => {
    expect(containsWelfareSignal(text)).toBe(true)
  })

  it.each([
    'great overview of asthma management',
    'the room was too warm and slides too small',
    'more hands-on practice would help',
  ])('does not flag teaching-quality text: %s', (text) => {
    expect(containsWelfareSignal(text)).toBe(false)
  })

  it('does not flag the safeguarding teaching topic itself', () => {
    expect(containsWelfareSignal('Intro to safeguarding for FY doctors')).toBe(false)
    expect(containsWelfareSignal('I want to raise a safeguarding concern about staff')).toBe(true)
  })
})
