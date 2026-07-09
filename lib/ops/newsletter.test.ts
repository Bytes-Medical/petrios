import { describe, expect, it } from 'vitest'
import {
  NewsletterSchema,
  buildNewsletterHtml,
  escapeHtml,
  makeUnsubToken,
  newsletterWeekWindow,
  verifyUnsubToken,
  UNSUBSCRIBE_PLACEHOLDER,
} from './newsletter'

describe('newsletterWeekWindow', () => {
  it('returns the previous complete Mon-Sun week from a mid-week date', () => {
    // Wednesday 2026-07-08
    const window = newsletterWeekWindow(new Date('2026-07-08T09:00:00Z'))
    expect(window.weekStartKey).toBe('2026-06-29')
    expect(window.weekEnd.toISOString().slice(0, 10)).toBe('2026-07-06')
  })

  it('on a Monday, the window is the week that just finished', () => {
    const window = newsletterWeekWindow(new Date('2026-07-06T00:00:00Z'))
    expect(window.weekStartKey).toBe('2026-06-29')
  })

  it('on a Sunday, the window is still the prior complete week', () => {
    const window = newsletterWeekWindow(new Date('2026-07-05T23:59:59Z'))
    expect(window.weekStartKey).toBe('2026-06-22')
  })

  it('handles month and year boundaries', () => {
    expect(newsletterWeekWindow(new Date('2026-01-01T12:00:00Z')).weekStartKey).toBe('2025-12-22')
    expect(newsletterWeekWindow(new Date('2026-03-04T12:00:00Z')).weekStartKey).toBe('2026-02-23')
  })

  it('window is exactly seven days', () => {
    const { weekStart, weekEnd } = newsletterWeekWindow(new Date('2026-07-09T10:00:00Z'))
    expect(weekEnd.getTime() - weekStart.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })
})

describe('unsubscribe tokens', () => {
  const secret = 'test-secret'
  const orgId = '11111111-2222-3333-4444-555555555555'
  const userId = '66666666-7777-8888-9999-000000000000'

  it('round-trips', () => {
    const token = makeUnsubToken(orgId, userId, secret)
    expect(verifyUnsubToken(token, secret)).toEqual({ orgId, userId })
  })

  it('rejects tampered payloads and signatures', () => {
    const token = makeUnsubToken(orgId, userId, secret)
    const [org, user, sig] = token.split('.')
    expect(verifyUnsubToken(`${org}.${orgId}.${sig}`, secret)).toBeNull()
    expect(verifyUnsubToken(`${org}.${user}.${'0'.repeat(sig.length)}`, secret)).toBeNull()
    expect(verifyUnsubToken('garbage', secret)).toBeNull()
    expect(verifyUnsubToken(`${org}.${user}`, secret)).toBeNull()
  })

  it('tokens signed with a different secret fail verification', () => {
    const token = makeUnsubToken(orgId, userId, 'other-secret')
    expect(verifyUnsubToken(token, secret)).toBeNull()
  })
})

describe('buildNewsletterHtml', () => {
  const content = {
    subject: 'Week in teaching',
    intro: 'Three sessions ran this week.',
    learning_points: [{ title: 'Sepsis <6>', detail: 'Early recognition & escalation' }],
    looking_ahead: 'DKA workshop on Friday.',
  }

  it('escapes HTML in model-authored and session-derived text', () => {
    const html = buildNewsletterHtml({ orgName: 'St <Elsewhere>', weekLabel: 'w/c 29 Jun', content })
    expect(html).toContain('St &lt;Elsewhere&gt;')
    expect(html).toContain('Sepsis &lt;6&gt;')
    expect(html).toContain('Early recognition &amp; escalation')
    expect(html).not.toContain('<6>')
  })

  it('contains the per-recipient unsubscribe placeholder', () => {
    const html = buildNewsletterHtml({ orgName: 'Org', weekLabel: 'w/c', content })
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER)
  })

  it('omits the looking-ahead section when empty', () => {
    const html = buildNewsletterHtml({
      orgName: 'Org',
      weekLabel: 'w/c',
      content: { ...content, looking_ahead: '  ' },
    })
    expect(html).not.toContain('Coming up')
  })
})

describe('NewsletterSchema', () => {
  it('bounds learning points to 1..8', () => {
    const base = {
      subject: 's',
      intro: 'i',
      looking_ahead: '',
      learning_points: [] as { title: string; detail: string }[],
    }
    expect(NewsletterSchema.safeParse(base).success).toBe(false)
    expect(
      NewsletterSchema.safeParse({
        ...base,
        learning_points: [{ title: 't', detail: 'd' }],
      }).success
    ).toBe(true)
    expect(
      NewsletterSchema.safeParse({
        ...base,
        learning_points: Array.from({ length: 9 }, () => ({ title: 't', detail: 'd' })),
      }).success
    ).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('escapes the five specials', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})
