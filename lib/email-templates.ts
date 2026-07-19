import { LOCATION_TYPE_LABELS } from '@/lib/types'
import type { Session } from '@/lib/types'
import { escapeHtml } from '@/lib/html'

interface TeacherFeedbackEmailParams {
  teacherName: string
  sessionTitle: string
  sessionDate: string
  departmentName: string
  totalResponses: number
  averageRating: number
  ratingDistribution: Record<number, number>
  questionSummaries: {
    fieldId: string
    label: string
    averageRating: number
    responseCount: number
    commentsCount: number
  }[]
  reviewedSummary: string | null
  privacySuppressed: boolean
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
    questionSummaries,
    reviewedSummary,
    privacySuppressed,
  } = params

  const safeTeacherName = escapeHtml(teacherName)
  const safeSessionTitle = escapeHtml(sessionTitle)
  const safeSessionDate = escapeHtml(sessionDate)
  const safeDepartmentName = escapeHtml(departmentName)

  const ratingBars = [5, 4, 3, 2, 1].map(star => {
    const count = ratingDistribution[star] || 0
    const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
    return `
      <tr>
        <td style="padding:4px 8px 4px 0;font-weight:bold;white-space:nowrap;">${star} ★</td>
        <td style="padding:4px 0;width:100%;">
          <div style="background:#eee;height:16px;border:1px solid #ccc;">
            <div style="background:#A95134;height:100%;width:${pct}%;"></div>
          </div>
        </td>
        <td style="padding:4px 0 4px 8px;white-space:nowrap;">${count}</td>
      </tr>
    `
  }).join('')

  const questionRows = questionSummaries
    .map((question) => {
      const score = Math.max(0, Math.min(5, question.averageRating))
      const width = Math.round((score / 5) * 100)
      return `
        <tr>
          <td style="padding:12px 12px 12px 0;border-bottom:1px solid #D8D4C9;vertical-align:top;">
            <div style="font-weight:bold;line-height:1.4;">${escapeHtml(question.label)}</div>
            <div style="margin-top:4px;font-size:11px;color:#6B665E;">${question.responseCount} scored response${question.responseCount === 1 ? '' : 's'}</div>
          </td>
          <td style="padding:12px 0;border-bottom:1px solid #D8D4C9;width:150px;vertical-align:top;">
            <div style="font-weight:bold;text-align:right;">${score.toFixed(1)} / 5</div>
            <div style="height:7px;background:#E4E0D7;margin-top:7px;">
              <div style="height:7px;width:${width}%;background:#A95134;"></div>
            </div>
          </td>
        </tr>`
    })
    .join('')

  const reviewedSummarySection = reviewedSummary
    ? `
      <div style="margin:28px 0;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#A95134;font-weight:bold;">Reviewed teaching summary</p>
        <div style="border-left:4px solid #A95134;background:#FAF9F5;padding:16px 18px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(reviewedSummary)}</div>
        <p style="margin:8px 0 0;font-size:11px;color:#6B665E;">AI-assisted draft, reviewed and approved by a Petrios moderator before release.</p>
      </div>`
    : ''

  const questionSection = questionRows
    ? `
      <div style="margin:28px 0;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#A95134;font-weight:bold;">Question-level performance</p>
        <table style="width:100%;border-collapse:collapse;">${questionRows}</table>
      </div>`
    : ''

  const noEvidenceNotice = `
    <div style="margin:24px 0;border:2px solid #A95134;background:#FFF8F3;padding:18px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#A95134;font-weight:bold;">No feedback evidence yet</p>
      <p style="margin:0;line-height:1.6;">No responses were available when this report was approved, so Petrios cannot provide scores or a coaching narrative.</p>
    </div>`

  const smallCohortNotice = totalResponses > 0 && totalResponses < 5
    ? `
      <div style="margin:24px 0;border:1px solid #A95134;background:#FFF8F3;padding:14px;font-size:12px;line-height:1.6;">
        <strong>Evidence note:</strong> This report is based on ${totalResponses} response${totalResponses === 1 ? '' : 's'}. Treat its scores and themes as limited, directional evidence rather than a representative conclusion, and do not use them to infer who submitted feedback.
      </div>`
    : ''

  return `
    <div style="margin:0;background:#F0EEE6;padding:24px 12px;color:#1F1D1A;">
      <div style="font-family:monospace;max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #D8D4C9;">
        <div style="background:#1F1D1A;color:#FFFFFF;padding:24px 28px;">
          <p style="margin:0 0 8px;color:#E7B39F;font-size:11px;letter-spacing:2px;font-weight:bold;">PETRIOS · TEACHING QUALITY</p>
          <h1 style="margin:0;font-size:26px;line-height:1.2;">Your session feedback</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 20px;">Dear ${safeTeacherName},</p>
          <p style="margin:0 0 24px;line-height:1.7;">Thank you for delivering <strong>${safeSessionTitle}</strong> on ${safeSessionDate} for ${safeDepartmentName}. This report turns the collected responses into practical information for your next teaching session.</p>

          <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 24px;">
            <tr>
              <td style="width:50%;background:#FAF9F5;border-top:4px solid #A95134;padding:14px;vertical-align:top;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6B665E;">Responses</div>
                <div style="font-size:26px;font-weight:bold;margin-top:5px;">${totalResponses}</div>
              </td>
              <td style="width:50%;background:#FAF9F5;border-top:4px solid #A95134;padding:14px;vertical-align:top;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6B665E;">Overall score</div>
                <div style="font-size:26px;font-weight:bold;margin-top:5px;">${privacySuppressed ? 'No data' : `${averageRating.toFixed(1)} / 5`}</div>
              </td>
            </tr>
          </table>

          ${privacySuppressed ? noEvidenceNotice : `
            ${smallCohortNotice}
            ${reviewedSummarySection}
            ${questionSection}
            <div style="margin:28px 0;">
              <p style="margin:0 0 12px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#A95134;font-weight:bold;">Overall response distribution</p>
              <table style="width:100%;border-collapse:collapse;">${ratingBars}</table>
            </div>
          `}

          <div style="margin-top:28px;padding:14px;background:#F0EEE6;font-size:12px;line-height:1.6;">Privacy note: no respondent names, email addresses, or raw comments are included. AI-assisted narrative is released only after moderator review. With a small cohort, the teacher may still be able to infer who participated, so the report must be interpreted cautiously.</div>
        </div>
        <div style="padding:16px 28px;background:#1F1D1A;color:#CFCBC1;font-size:11px;">Sent securely via Petrios.</div>
      </div>
    </div>
  `
}

export function buildCertificateEmailHtml(
  sessionTitle: string,
  recipientName: string,
  options: { role?: 'ATTENDEE' | 'TEACHER'; attached?: boolean } = {}
): string {
  const safeSessionTitle = escapeHtml(sessionTitle)
  const safeRecipientName = escapeHtml(recipientName)
  const isTeacher = options.role === 'TEACHER'
  const certificateLabel = isTeacher ? 'Teaching Certificate' : 'Attendance Certificate'
  const deliveryText = options.attached
    ? `Your ${certificateLabel.toLowerCase()} is attached to this email as a PDF. No Petrios account is required.`
    : `Your ${certificateLabel.toLowerCase()} is now ready for download when you sign in to your dashboard.`
  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">Your ${certificateLabel}</h2>
      <p style="margin:20px 0;">Dear ${safeRecipientName},</p>
      <p style="margin:20px 0;">${isTeacher ? 'Thank you for teaching' : 'Thank you for attending'} <strong>${safeSessionTitle}</strong>. ${deliveryText}</p>
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
  /** Micro-slot (<= 20 min) — marked in the row and invites first-timers. */
  lightning?: boolean
}

const LIGHTNING_INTRO_SENTENCE =
  ' Some of these are lightning slots — 10–20 minute micro-teaching sessions: one topic, low stakes, a great first teaching slot.'

function slotOfferTableRows(slots: SlotOfferEmailSlot[]): string {
  return slots
    .map(
      (slot) => `
        <tr>
          <td style="padding:8px 8px 8px 0;font-weight:bold;white-space:nowrap;vertical-align:top;">${slot.dateStr}</td>
          <td style="padding:8px 0;">${slot.timeRangeStr} (${slot.durationStr}${slot.lightning ? ' · lightning' : ''}) — ${slot.locationLabel}</td>
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
    intro: `${params.departmentName} is looking for teachers and has opened the following teaching slots. Pick one that suits you — no account needed.${params.slots.some((slot) => slot.lightning) ? LIGHTNING_INTRO_SENTENCE : ''}`,
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
    intro: `${params.departmentName} is looking for teachers and has opened the following teaching slots. Sign in and claim one from the Teaching tab on your dashboard.${params.slots.some((slot) => slot.lightning) ? LIGHTNING_INTRO_SENTENCE : ''}`,
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
