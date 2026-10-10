import { describe, expect, it } from 'vitest'
import {
  buildCertificateEmailHtml,
  buildDepartmentInviteActivationEmailHtml,
  buildDepartmentJoinMagicLinkEmailHtml,
  buildInvitationEmailHtml,
  buildModeratorWelcomeEmailHtml,
  buildPasswordlessLoginEmailHtml,
  buildRecallEmailHtml,
  buildSessionReminderEmailHtml,
  buildSlotClaimedEmailHtml,
  buildSlotOfferExternalEmailHtml,
  buildSlotOfferMemberEmailHtml,
  buildTeacherFeedbackEmailHtml,
  buildTeacherResponseEmailHtml,
  buildTraineeSessionReportEmailHtml,
  sessionEmailTimes,
} from './email-templates'
import type { Session } from './types'

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

describe('session email times', () => {
  // 15:15–16:15 UTC on 9 Oct 2026 is 16:15–17:15 BST.
  const dateStart = '2026-10-09T15:15:00+00:00'
  const dateEnd = '2026-10-09T16:15:00+00:00'

  it('renders a BST session in London time on a UTC server', () => {
    expect(sessionEmailTimes(dateStart, dateEnd)).toEqual({
      dateStr: 'Friday, 9 October 2026',
      startTime: '16:15',
      endTime: '17:15',
    })
  })

  it('renders a GMT session unchanged', () => {
    expect(
      sessionEmailTimes('2026-12-01T09:00:00Z', '2026-12-01T10:30:00Z')
    ).toMatchObject({ startTime: '09:00', endTime: '10:30' })
  })

  it('uses London time in the teaching invitation', () => {
    const html = buildInvitationEmailHtml(
      {
        title: 'Sepsis update',
        description: null,
        location_type: 'IN_PERSON',
        date_start: dateStart,
        date_end: dateEnd,
      } as unknown as Session,
      'Medicine',
      'https://example.test/rsvp'
    )
    expect(html).toContain('Friday, 9 October 2026')
    expect(html).toContain('16:15 - 17:15')
    expect(html).not.toContain('15:15')
  })

  it('escapes session and department text in the teaching invitation', () => {
    const html = buildInvitationEmailHtml(
      {
        title: '<img src=x onerror=alert(1)>',
        description: 'Bring <b>notes</b> & questions',
        location_type: 'IN_PERSON',
        date_start: dateStart,
        date_end: dateEnd,
      } as unknown as Session,
      'A&E "Resus"',
      'https://example.test/rsvp?a=1&b=2'
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('Bring &lt;b&gt;notes&lt;/b&gt; &amp; questions')
    expect(html).toContain('A&amp;E &quot;Resus&quot;')
    expect(html).toContain('href="https://example.test/rsvp?a=1&amp;b=2"')
  })
})

describe('untrusted text in every email builder', () => {
  const NAME = '<a href=x>Click me</a>'
  const TITLE = '<img src=x onerror=alert(1)>'
  const URL = 'https://petrios.example/x?a=1&b="2"'

  function expectEscaped(html: string) {
    expect(html).not.toContain('<a href=x>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;a href=x&gt;Click me&lt;/a&gt;')
    expect(html).not.toContain('b="2"')
  }

  it.each([
    ['slot claimed', () => buildSlotClaimedEmailHtml({
      claimerName: NAME,
      departmentName: TITLE,
      slotDateStr: TITLE,
      slotTimeStr: TITLE,
      manageUrl: URL,
    })],
    ['teacher response', () => buildTeacherResponseEmailHtml({
      teacherName: NAME,
      accepted: true,
      sessionTitle: TITLE,
      dateStr: TITLE,
      manageUrl: URL,
    })],
    ['session reminder', () => buildSessionReminderEmailHtml({
      recipientName: NAME,
      sessionTitle: TITLE,
      departmentName: TITLE,
      dateStr: TITLE,
      startTime: '16:15',
      endTime: '17:15',
      locationLabel: TITLE,
      meetingUrl: URL,
      sessionUrl: URL,
    })],
    ['external slot offer', () => buildSlotOfferExternalEmailHtml({
      departmentName: NAME,
      slots: [{ dateStr: TITLE, timeRangeStr: TITLE, durationStr: TITLE, locationLabel: TITLE }],
      claimUrl: URL,
    })],
    ['member slot offer', () => buildSlotOfferMemberEmailHtml({
      departmentName: NAME,
      slots: [{ dateStr: TITLE, timeRangeStr: TITLE, durationStr: TITLE, locationLabel: TITLE, lightning: true }],
      dashboardUrl: URL,
    })],
    ['department invite', () => buildDepartmentInviteActivationEmailHtml({
      departmentName: TITLE,
      organizationName: TITLE,
      inviteUrl: URL,
      firstName: NAME,
    })],
    ['department join link', () => buildDepartmentJoinMagicLinkEmailHtml({
      departmentName: TITLE,
      organizationName: TITLE,
      inviteUrl: URL,
      firstName: NAME,
    })],
    ['passwordless sign-in', () => buildPasswordlessLoginEmailHtml({ inviteUrl: URL, firstName: NAME })],
    ['moderator welcome', () => buildModeratorWelcomeEmailHtml({
      departmentName: NAME,
      organizationName: TITLE,
      email: 'mod@example.org',
      loginUrl: URL,
    })],
    ['recall catch-up', () => buildRecallEmailHtml({
      recipientName: NAME,
      sessionTitle: TITLE,
      kind: 'CATCH_UP',
      answerUrl: URL,
      deadlineStr: TITLE,
    })],
    ['trainee report', () => buildTraineeSessionReportEmailHtml({
      recipientName: NAME,
      sessionTitle: TITLE,
      sessionDate: TITLE,
      departmentName: TITLE,
      attendanceStatus: 'PRESENT',
      totalResponses: 1,
      averageRating: 5,
      ratingDistribution: { 5: 1 },
      comments: [TITLE],
    })],
  ])('escapes names, titles and links in the %s email', (_label, build) => {
    expectEscaped(build())
  })

  it('keeps the recall catch-up intro neutral about why the session was missed', () => {
    const html = buildRecallEmailHtml({
      recipientName: 'Ada',
      sessionTitle: 'Sepsis',
      kind: 'CATCH_UP',
      answerUrl: 'https://petrios.example/recall/token',
      deadlineStr: 'Friday, 30 October 2026',
    })
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    expect(text).toContain('You missed Sepsis . An optional catch-up is available until Friday, 30 October 2026')
    expect(text).toContain('Where you can, complete it in working time.')
    expect(text).toContain('It does not replace exception reporting for missed teaching.')
    // Shared by ABSENT and EXCUSED results: no rota, leave or absence wording.
    expect(text).not.toMatch(/\brota\b/i)
    expect(text).not.toMatch(/absent/i)
    expect(text).not.toMatch(/excused|leave|sick/i)
  })

  it('keeps the reminder join link usable after escaping', () => {
    const html = buildSessionReminderEmailHtml({
      recipientName: 'Ada',
      sessionTitle: 'Sepsis',
      departmentName: 'Medicine',
      dateStr: 'Friday, 9 October 2026',
      startTime: '16:15',
      endTime: '17:15',
      locationLabel: 'Petrios Meet',
      meetingUrl: 'https://meet.example/room?a=1&b=2',
      sessionUrl: 'https://petrios.example/sessions/1',
    })
    expect(html).toContain('href="https://meet.example/room?a=1&amp;b=2"')
    expect(html).toContain('href="https://petrios.example/sessions/1"')
  })
})
