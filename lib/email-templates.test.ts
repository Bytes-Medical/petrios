import { describe, expect, it } from 'vitest'
import {
  buildCertificateEmailHtml,
  buildTeacherFeedbackEmailHtml,
} from './email-templates'

describe('privacy-safe feedback email', () => {
  it('withholds small-cohort analytics and never has a raw-comment section', () => {
    const html = buildTeacherFeedbackEmailHtml({
      teacherName: 'Dr Teacher',
      sessionTitle: 'Teaching',
      sessionDate: '1 July 2026',
      departmentName: 'Medicine',
      totalResponses: 4,
      averageRating: 4.8,
      ratingDistribution: { 5: 4 },
      privacySuppressed: true,
    })
    expect(html).toContain('Average Rating:</td>')
    expect(html).toContain('Withheld')
    expect(html).not.toContain('4.8/5')
    expect(html).not.toContain('Rating Breakdown')
    expect(html).toContain('No respondent names, email addresses, or raw comments')
  })

  it('escapes identity and session fields', () => {
    const html = buildTeacherFeedbackEmailHtml({
      teacherName: '<img src=x onerror=alert(1)>',
      sessionTitle: '<script>alert(1)</script>',
      sessionDate: 'date',
      departmentName: 'department',
      totalResponses: 5,
      averageRating: 4,
      ratingDistribution: { 4: 5 },
      privacySuppressed: false,
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('certificate email', () => {
  it('escapes recipient and session values', () => {
    const html = buildCertificateEmailHtml('<script>session</script>', '<b>person</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>person</b>')
    expect(html).toContain('&lt;script&gt;session&lt;/script&gt;')
  })
})
