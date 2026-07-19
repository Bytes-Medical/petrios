import { describe, expect, it } from 'vitest'
import {
  buildCertificateEmailHtml,
  buildTeacherFeedbackEmailHtml,
} from './email-templates'

describe('privacy-safe feedback email', () => {
  it('renders approved small-cohort analytics and narrative with an evidence warning', () => {
    const html = buildTeacherFeedbackEmailHtml({
      teacherName: 'Dr Teacher',
      sessionTitle: 'Teaching',
      sessionDate: '1 July 2026',
      departmentName: 'Medicine',
      totalResponses: 4,
      averageRating: 4.8,
      ratingDistribution: { 5: 4 },
      questionSummaries: [{
        fieldId: 'pace',
        label: 'Pacing',
        averageRating: 4.5,
        responseCount: 4,
        commentsCount: 1,
      }],
      reviewedSummary: 'Limited evidence suggests adding more interaction.',
      privacySuppressed: false,
    })
    expect(html).toContain('This report is based on 4 responses')
    expect(html).toContain('limited, directional evidence')
    expect(html).toContain('4.8 / 5')
    expect(html).toContain('Question-level performance')
    expect(html).toContain('Limited evidence suggests adding more interaction.')
    expect(html).toContain('no respondent names, email addresses, or raw comments')
  })

  it('withholds analysis only when no feedback exists', () => {
    const html = buildTeacherFeedbackEmailHtml({
      teacherName: 'Dr Teacher',
      sessionTitle: 'Teaching',
      sessionDate: '1 July 2026',
      departmentName: 'Medicine',
      totalResponses: 0,
      averageRating: 0,
      ratingDistribution: {},
      questionSummaries: [],
      reviewedSummary: null,
      privacySuppressed: true,
    })
    expect(html).toContain('No feedback evidence yet')
    expect(html).toContain('No data')
    expect(html).not.toContain('Reviewed teaching summary')
    expect(html).not.toContain('Overall response distribution')
  })

  it('renders useful approved analytics and escapes every teacher-facing field', () => {
    const html = buildTeacherFeedbackEmailHtml({
      teacherName: '<img src=x onerror=alert(1)>',
      sessionTitle: '<script>alert(1)</script>',
      sessionDate: 'date',
      departmentName: 'department',
      totalResponses: 5,
      averageRating: 4,
      ratingDistribution: { 4: 5 },
      questionSummaries: [{
        fieldId: 'pace',
        label: '<script>Question</script>',
        averageRating: 3.8,
        responseCount: 5,
        commentsCount: 2,
      }],
      reviewedSummary: 'Overall: useful\n- <img src=x onerror=alert(1)>',
      privacySuppressed: false,
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Reviewed teaching summary')
    expect(html).toContain('Question-level performance')
    expect(html).toContain('3.8 / 5')
    expect(html).toContain('Overall response distribution')
  })
})

describe('certificate email', () => {
  it('escapes recipient and session values', () => {
    const html = buildCertificateEmailHtml('<script>session</script>', '<b>person</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>person</b>')
    expect(html).toContain('&lt;script&gt;session&lt;/script&gt;')
  })

  it('explains attached teaching certificates do not require an account', () => {
    const html = buildCertificateEmailHtml('Clinical teaching', 'Dr External', {
      role: 'TEACHER',
      attached: true,
    })
    expect(html).toContain('Your Teaching Certificate')
    expect(html).toContain('Thank you for teaching')
    expect(html).toContain('attached to this email as a PDF')
    expect(html).toContain('No Petrios account is required')
  })
})
