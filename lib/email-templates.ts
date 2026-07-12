import { LOCATION_TYPE_LABELS } from '@/lib/types'
import type { Session } from '@/lib/types'

interface TeacherFeedbackEmailParams {
  teacherName: string
  sessionTitle: string
  sessionDate: string
  departmentName: string
  totalResponses: number
  averageRating: number
  ratingDistribution: Record<number, number>
  comments: { attendee_first_name: string | null; attendee_last_name: string | null; comment: string }[]
}

export function buildTeacherFeedbackEmailHtml(params: TeacherFeedbackEmailParams): string {
  const {
    teacherName,
    sessionTitle,
    sessionDate,
    departmentName,
    totalResponses,
    averageRating,
    ratingDistribution,
    comments,
  } = params

  const ratingBars = [5, 4, 3, 2, 1].map(star => {
    const count = ratingDistribution[star] || 0
    const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
    return `
      <tr>
        <td style="padding:4px 8px 4px 0;font-weight:bold;white-space:nowrap;">${star} ★</td>
        <td style="padding:4px 0;width:100%;">
          <div style="background:#eee;height:16px;border:1px solid #ccc;">
            <div style="background:#000;height:100%;width:${pct}%;"></div>
          </div>
        </td>
        <td style="padding:4px 0 4px 8px;white-space:nowrap;">${count}</td>
      </tr>
    `
  }).join('')

  const commentsSection = comments.length > 0
    ? `
      <h3 style="font-size:14px;margin:24px 0 12px;">Attendee Comments</h3>
      ${comments.map(c => {
        const name = [c.attendee_first_name, c.attendee_last_name].filter(Boolean).join(' ') || 'Anonymous'
        return `
          <div style="border-left:3px solid #000;padding:8px 12px;margin:8px 0;background:#fafafa;">
            <p style="margin:0 0 4px;font-size:12px;color:#666;">${name}</p>
            <p style="margin:0;">${c.comment}</p>
          </div>
        `
      }).join('')}
    `
    : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Session Feedback Summary</h2>
      <p style="margin:20px 0;">Dear ${teacherName},</p>
      <p style="margin:20px 0;">Thank you for delivering <strong>${sessionTitle}</strong> on ${sessionDate} (${departmentName}). Below is a summary of the feedback collected from attendees.</p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr>
          <td style="padding:8px 0;font-weight:bold;">Total Responses:</td>
          <td style="padding:8px 0;">${totalResponses}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;">Average Rating:</td>
          <td style="padding:8px 0;">${averageRating}/5</td>
        </tr>
      </table>

      <h3 style="font-size:14px;margin:20px 0 12px;">Rating Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;">
        ${ratingBars}
      </table>

      ${commentsSection}

      <p style="margin:24px 0 12px;"><strong>Your teaching certificate is attached to this email.</strong></p>

      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

export function buildCertificateEmailHtml(
  sessionTitle: string,
  recipientName: string
): string {
  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Your Attendance Certificate</h2>
      <p style="margin:20px 0;">Dear ${recipientName},</p>
      <p style="margin:20px 0;">Thank you for attending <strong>${sessionTitle}</strong>. Your attendance certificate is now ready for download when you sign in to your dashboard.</p>
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

export interface SlotOfferEmailSlot {
  dateStr: string
  timeRangeStr: string
  durationStr: string
  locationLabel: string
}

function slotOfferTableRows(slots: SlotOfferEmailSlot[]): string {
  return slots
    .map(
      (slot) => `
        <tr>
          <td style="padding:8px 8px 8px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">${slot.dateStr}</td>
          <td style="padding:8px 0;">${slot.timeRangeStr} (${slot.durationStr}) — ${slot.locationLabel}</td>
        </tr>`
    )
    .join('')
}

interface SlotOfferEmailParams {
  departmentName: string
  slots: SlotOfferEmailSlot[]
  ctaUrl: string
  ctaLabel: string
  intro: string
}

function buildSlotOfferEmailHtml(params: SlotOfferEmailParams): string {
  const { departmentName, slots, ctaUrl, ctaLabel, intro } = params
  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Teaching slots available</h2>
      <p style="margin:20px 0;">${intro}</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        ${slotOfferTableRows(slots)}
      </table>
      <p style="margin:20px 0;">
        <a href="${ctaUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">${ctaLabel}</a>
      </p>
      <p style="font-size:12px;color:#666;">Slots are first come, first served — once a slot is claimed it disappears for everyone else. The ${departmentName} organiser will confirm the topic with you afterwards.</p>
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

export function buildSlotOfferExternalEmailHtml(params: {
  departmentName: string
  slots: SlotOfferEmailSlot[]
  claimUrl: string
}): string {
  return buildSlotOfferEmailHtml({
    departmentName: params.departmentName,
    slots: params.slots,
    ctaUrl: params.claimUrl,
    ctaLabel: 'View & claim a slot',
    intro: `${params.departmentName} is looking for teachers and has opened the following teaching slots. Pick one that suits you — no account needed.`,
  })
}

export function buildSlotOfferMemberEmailHtml(params: {
  departmentName: string
  slots: SlotOfferEmailSlot[]
  dashboardUrl: string
}): string {
  return buildSlotOfferEmailHtml({
    departmentName: params.departmentName,
    slots: params.slots,
    ctaUrl: params.dashboardUrl,
    ctaLabel: 'Claim a slot on your dashboard',
    intro: `${params.departmentName} is looking for teachers and has opened the following teaching slots. Sign in and claim one from the Teaching tab on your dashboard.`,
  })
}

export function buildSlotClaimedEmailHtml(params: {
  claimerName: string
  departmentName: string
  slotDateStr: string
  slotTimeStr: string
  manageUrl: string
}): string {
  const { claimerName, departmentName, slotDateStr, slotTimeStr, manageUrl } = params
  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Teaching slot claimed</h2>
      <p style="margin:20px 0;">
        <strong>${claimerName}</strong> has claimed the ${departmentName} teaching slot on
        <strong>${slotDateStr}</strong> at ${slotTimeStr}. A draft session has been created —
        assign the topic and publish it when you're ready.
      </p>
      <p style="margin:20px 0;">
        <a href="${manageUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">Manage Session</a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

interface TeacherResponseEmailParams {
  teacherName: string
  accepted: boolean
  sessionTitle: string
  dateStr: string
  manageUrl: string
}

export function buildTeacherResponseEmailHtml(params: TeacherResponseEmailParams): string {
  const { teacherName, accepted, sessionTitle, dateStr, manageUrl } = params
  const verb = accepted ? 'accepted' : 'declined'

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Teaching invitation ${verb}</h2>
      <p style="margin:20px 0;">
        <strong>${teacherName}</strong> has ${verb} your invitation to teach
        <strong>${sessionTitle}</strong> on ${dateStr}.
      </p>
      <p style="margin:20px 0;">
        <a href="${manageUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">View Session</a>
      </p>
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

interface SessionReminderEmailParams {
  recipientName: string
  sessionTitle: string
  departmentName: string
  dateStr: string
  startTime: string
  endTime: string
  locationLabel: string
  meetingUrl: string | null
  sessionUrl: string
}

export function buildSessionReminderEmailHtml(params: SessionReminderEmailParams): string {
  const {
    recipientName,
    sessionTitle,
    departmentName,
    dateStr,
    startTime,
    endTime,
    locationLabel,
    meetingUrl,
    sessionUrl,
  } = params

  const meetingRow = meetingUrl
    ? `
      <tr>
        <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Join link:</td>
        <td style="padding:8px 0;"><a href="${meetingUrl}" style="color:#000;">${meetingUrl}</a></td>
      </tr>
    `
    : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Teaching Session Tomorrow</h2>
      <p style="margin:20px 0;">Dear ${recipientName},</p>
      <p style="margin:20px 0;">A reminder that <strong>${sessionTitle}</strong> (${departmentName}) is coming up.</p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr>
          <td style="padding:8px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">When:</td>
          <td style="padding:8px 0;">${dateStr}, ${startTime}&ndash;${endTime}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Where:</td>
          <td style="padding:8px 0;">${locationLabel}</td>
        </tr>
        ${meetingRow}
      </table>

      <p style="margin:20px 0;">
        <a href="${sessionUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">View Session</a>
      </p>

      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

export function buildInvitationEmailHtml(
  session: Session,
  departmentName: string,
  rsvpUrl: string
): string {
  const startDate = new Date(session.date_start)
  const endDate = new Date(session.date_end)
  const dateStr = startDate.toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const startTime = startDate.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit'
  })
  const endTime = endDate.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit'
  })


  const descriptionSection = session.description
    ? `<tr>
         <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Description:</td>
         <td style="padding:8px 0;">${session.description}</td>
       </tr>`
    : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">You have been invited to teach a session</h2>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Session:</td>
          <td style="padding:8px 0;">${session.title}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Department:</td>
          <td style="padding:8px 0;">${departmentName}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Date:</td>
          <td style="padding:8px 0;">${dateStr}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Time:</td>
          <td style="padding:8px 0;">${startTime} - ${endTime}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Location:</td>
          <td style="padding:8px 0;">${LOCATION_TYPE_LABELS[session.location_type] || session.location_type}</td>
        </tr>
        ${descriptionSection}
      </table>
      <p style="margin:20px 0;">Please confirm your participation by clicking the link below:</p>
      <a href="${rsvpUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-family:monospace;font-size:14px;">
        Respond to Invitation
      </a>
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

interface DepartmentInviteEmailParams {
  departmentName: string
  organizationName: string
  inviteUrl: string
  firstName?: string | null
}

interface PasswordlessLoginEmailParams {
  inviteUrl: string
  firstName?: string | null
}

function buildMonospaceEmailShell(title: string, body: string) {
  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">${title}</h2>
      ${body}
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Petrios.
      </p>
    </div>
  `
}

export function buildDepartmentInviteActivationEmailHtml(
  params: DepartmentInviteEmailParams
) {
  const greeting = params.firstName ? `Dear ${params.firstName},` : 'Hello,'

  return buildMonospaceEmailShell(
    'Activate Your Department Access',
    `
      <p style="margin:20px 0;">${greeting}</p>
      <p style="margin:20px 0;">
        You have been invited to join <strong>${params.departmentName}</strong> in
        <strong>${params.organizationName}</strong>.
      </p>
      <p style="margin:20px 0;">
        Click the link below to activate your access and finish joining the department.
      </p>
      <a href="${params.inviteUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-family:monospace;font-size:14px;">
        Activate Access
      </a>
    `
  )
}

export function buildDepartmentJoinMagicLinkEmailHtml(
  params: DepartmentInviteEmailParams
) {
  const greeting = params.firstName ? `Dear ${params.firstName},` : 'Hello,'

  return buildMonospaceEmailShell(
    'Confirm Department Join',
    `
      <p style="margin:20px 0;">${greeting}</p>
      <p style="margin:20px 0;">
        Use the secure sign-in link below to join <strong>${params.departmentName}</strong>
        in <strong>${params.organizationName}</strong>.
      </p>
      <p style="margin:20px 0;">
        If you currently belong to another organization, your access will move when you complete this sign-in.
      </p>
      <a href="${params.inviteUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-family:monospace;font-size:14px;">
        Join Department
      </a>
    `
  )
}

export function buildPasswordlessLoginEmailHtml(
  params: PasswordlessLoginEmailParams
) {
  const greeting = params.firstName ? `Dear ${params.firstName},` : 'Hello,'

  return buildMonospaceEmailShell(
    'Your Sign-In Link',
    `
      <p style="margin:20px 0;">${greeting}</p>
      <p style="margin:20px 0;">
        Click the link below to sign in to Petrios.
      </p>
      <a href="${params.inviteUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-family:monospace;font-size:14px;">
        Sign In
      </a>
    `
  )
}

interface TraineeSessionReportParams {
  recipientName: string
  sessionTitle: string
  sessionDate: string
  departmentName: string
  attendanceStatus: string
  totalResponses: number
  averageRating: number
  ratingDistribution: Record<number, number>
  comments: string[]
}

export function buildTraineeSessionReportEmailHtml(params: TraineeSessionReportParams): string {
  const {
    recipientName,
    sessionTitle,
    sessionDate,
    departmentName,
    attendanceStatus,
    totalResponses,
    averageRating,
    ratingDistribution,
    comments,
  } = params

  const statusColor = attendanceStatus === 'PRESENT' ? '#16a34a' : attendanceStatus === 'LATE' ? '#ca8a04' : '#dc2626'

  const ratingBars = [5, 4, 3, 2, 1].map(star => {
    const count = ratingDistribution[star] || 0
    const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
    return `
      <tr>
        <td style="padding:2px 6px 2px 0;font-weight:bold;white-space:nowrap;">${star} ★</td>
        <td style="padding:2px 0;width:100%;">
          <div style="background:#eee;height:12px;border:1px solid #ccc;">
            <div style="background:#000;height:100%;width:${pct}%;"></div>
          </div>
        </td>
        <td style="padding:2px 0 2px 6px;white-space:nowrap;">${count}</td>
      </tr>
    `
  }).join('')

  const commentsSection = comments.length > 0
    ? `
      <h3 style="font-size:13px;margin:16px 0 8px;">Session Comments</h3>
      ${comments.map(c => `
        <div style="border-left:3px solid #000;padding:6px 10px;margin:6px 0;background:#fafafa;">
          <p style="margin:0;font-size:12px;">${c}</p>
        </div>
      `).join('')}
    `
    : ''

  return buildMonospaceEmailShell(
    'Your Session Report',
    `
      <p style="margin:16px 0;">Dear ${recipientName},</p>
      <p style="margin:16px 0;">Here is your report for <strong>${sessionTitle}</strong> on ${sessionDate} (${departmentName}).</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <td style="padding:6px 0;font-weight:bold;">Your Attendance:</td>
          <td style="padding:6px 0;"><span style="color:${statusColor};font-weight:bold;">${attendanceStatus}</span></td>
        </tr>
      </table>

      <h3 style="font-size:13px;margin:16px 0 8px;">Session Feedback Summary</h3>
      <table style="width:100%;border-collapse:collapse;margin:8px 0;">
        <tr>
          <td style="padding:4px 0;font-weight:bold;">Responses:</td>
          <td style="padding:4px 0;">${totalResponses}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-weight:bold;">Average Rating:</td>
          <td style="padding:4px 0;">${averageRating > 0 ? `${averageRating}/5` : '—'}</td>
        </tr>
      </table>

      ${totalResponses > 0 ? `
        <table style="width:100%;border-collapse:collapse;margin:8px 0;">
          ${ratingBars}
        </table>
      ` : ''}

      ${commentsSection}

      <p style="margin:16px 0;font-weight:bold;">Your attendance certificate is attached to this email.</p>
    `
  )
}

interface ModeratorWelcomeEmailParams {
  departmentName: string
  organizationName: string
  email: string
  loginUrl: string
}

export function buildModeratorWelcomeEmailHtml(params: ModeratorWelcomeEmailParams): string {
  return buildMonospaceEmailShell(
    'Moderator Access Granted',
    `
      <p style="margin:20px 0;">Hello,</p>
      <p style="margin:20px 0;">
        You have been added as a <strong>moderator</strong> for
        <strong>${params.departmentName}</strong> in
        <strong>${params.organizationName}</strong>.
      </p>
      <p style="margin:20px 0;">
        As a moderator you can create sessions, manage teachers, track attendance, and release feedback reports.
      </p>
      <a href="${params.loginUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;text-decoration:none;font-family:monospace;font-size:14px;">
        Sign In
      </a>
    `
  )
}

interface RecallEmailParams {
  recipientName: string
  sessionTitle: string
  kind: 'RETENTION' | 'CATCH_UP' | 'BOOST'
  answerUrl: string
  deadlineStr: string
}

export function buildRecallEmailHtml(params: RecallEmailParams): string {
  const intro =
    params.kind === 'CATCH_UP'
      ? `You missed <strong>${params.sessionTitle}</strong> — you can still have
         it count. Answer three quick recall questions (pass 2 of 3) by
         <strong>${params.deadlineStr}</strong> and your attendance will be
         recorded as caught up.`
      : params.kind === 'BOOST'
        ? `One week left: a final chance to lock in the learning from
           <strong>${params.sessionTitle}</strong>. Three quick questions,
           open until <strong>${params.deadlineStr}</strong>.`
        : `Quick knowledge check from <strong>${params.sessionTitle}</strong> —
           three questions, two minutes. Spaced recall is the best-evidenced
           way to make teaching stick.`

  return buildMonospaceEmailShell(
    params.kind === 'CATCH_UP' ? 'Catch up on a missed session' : 'Quick recall check',
    `
      <p style="margin:20px 0;">Hi ${params.recipientName},</p>
      <p style="margin:20px 0;">${intro}</p>
      <p style="margin:20px 0;">
        <a href="${params.answerUrl}" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">Answer the questions</a>
      </p>
      <p style="font-size:12px;color:#666;">One attempt; your score and the explanations are shown straight after.</p>
    `
  )
}
