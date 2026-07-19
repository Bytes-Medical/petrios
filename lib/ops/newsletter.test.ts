import { describe, expect, it } from 'vitest'
import {
  NewsletterSchema,
  buildNewsletterHtml,
  escapeHtml,
  makeUnsubToken,
  newsletterSchemaForSessions,
  newsletterWeekWindow,
  newsletterWindowFromWeekStart,
  newsletterWordCount,
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

describe('newsletterWindowFromWeekStart', () => {
  it('accepts a completed Monday-Sunday week', () => {
    const window = newsletterWindowFromWeekStart('2026-06-29', new Date('2026-07-08T12:00:00Z'))
    expect(window.weekEnd.toISOString()).toBe('2026-07-06T00:00:00.000Z')
  })

  it('accepts the current in-progress week (draft covers the week so far)', () => {
    const window = newsletterWindowFromWeekStart('2026-07-06', new Date('2026-07-08T12:00:00Z'))
    expect(window.weekStartKey).toBe('2026-07-06')
  })

  it('rejects non-Mondays and weeks that have not started', () => {
    expect(() => newsletterWindowFromWeekStart('2026-06-30', new Date('2026-07-08T12:00:00Z')))
      .toThrow('Monday')
    expect(() => newsletterWindowFromWeekStart('2026-07-13', new Date('2026-07-08T12:00:00Z')))
      .toThrow("hasn't started")
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
    sessions: [{
      session_id: '11111111-1111-4111-8111-111111111111',
      title: 'Sepsis <6>',
      date_label: 'Monday & Tuesday',
      overview: 'Early recognition & escalation',
      learning_points: ['Escalate <early>'],
    }],
    closing: 'Keep learning & sharing.',
  }

  it('escapes HTML in model-authored and session-derived text', () => {
    const html = buildNewsletterHtml({
      organizationName: 'St <Elsewhere>',
      departmentName: 'Paediatrics & Neonates',
      weekLabel: 'w/c 29 Jun',
      content,
    })
    expect(html).toContain('St &lt;Elsewhere&gt;')
    expect(html).toContain('Paediatrics &amp; Neonates')
    expect(html).toContain('Sepsis &lt;6&gt;')
    expect(html).toContain('Early recognition &amp; escalation')
    expect(html).not.toContain('<6>')
  })

  it('contains the per-recipient unsubscribe placeholder', () => {
    const html = buildNewsletterHtml({
      organizationName: 'Org',
      departmentName: 'Department',
      weekLabel: 'w/c',
      content,
    })
    expect(html).toContain(UNSUBSCRIBE_PLACEHOLDER)
  })

  it('uses the compact Petrios one-page visual treatment', () => {
    const html = buildNewsletterHtml({
      organizationName: 'Org',
      departmentName: 'Department',
      weekLabel: 'w/c',
      content,
    })
    expect(html).toContain('max-width:680px')
    expect(html).toContain('box-shadow:3px 3px 0 #c96f4a')
  })
})

describe('NewsletterSchema', () => {
  const session = {
    session_id: '11111111-1111-4111-8111-111111111111',
    title: 'Session',
    date_label: 'Monday 29 June',
    overview: 'A concise overview.',
    learning_points: ['One point'],
  }

  it('requires one to three learning points per delivered session', () => {
    const base = {
      subject: 's',
      intro: 'i',
      closing: 'c',
      sessions: [{ ...session, learning_points: [] as string[] }],
    }
    expect(NewsletterSchema.safeParse(base).success).toBe(false)
    expect(
      NewsletterSchema.safeParse({
        ...base,
        sessions: [session],
      }).success
    ).toBe(true)
    expect(
      NewsletterSchema.safeParse({
        ...base,
        sessions: [{ ...session, learning_points: ['1', '2', '3', '4'] }],
      }).success
    ).toBe(false)
  })

  it('requires every expected session exactly once', () => {
    const secondId = '22222222-2222-4222-8222-222222222222'
    const schema = newsletterSchemaForSessions([session.session_id, secondId])
    const content = { subject: 's', intro: 'i', closing: 'c', sessions: [session] }
    expect(schema.safeParse(content).success).toBe(false)
    expect(schema.safeParse({
      ...content,
      sessions: [session, { ...session, session_id: secondId }],
    }).success).toBe(true)
  })

  it('enforces the one-page word budget', () => {
    const content = {
      subject: 'Weekly teaching',
      intro: Array.from({ length: 650 }, () => 'word').join(' '),
      sessions: [session],
      closing: Array.from({ length: 80 }, () => 'word').join(' '),
    }
    expect(newsletterWordCount(content)).toBeGreaterThan(700)
    expect(NewsletterSchema.safeParse(content).success).toBe(false)
  })
})

describe('escapeHtml', () => {
  it('escapes the five specials', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })
})
