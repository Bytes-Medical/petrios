'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireOrg, requireDepartmentModerator } from '@/lib/auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { getAppUrl } from '@/lib/app-url'
import { LOCATION_TYPE_LABELS, type EmailType, type Session } from '@/lib/types'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import * as sessionsDb from '@/lib/db/sessions'
import * as teacherEmailsDb from '@/lib/db/teacher-emails'
import * as teacherInvitationsDb from '@/lib/db/teacher-invitations'
import { DbNotFoundError } from '@/lib/db'

export async function sendTeacherEmail(
  sessionId: string,
  teacherUserId: string,
  emailType: EmailType
) {
  const currentUserId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const teachers = await sessionsDb.listSessionTeachers(orgId, sessionId)
  const teacherAssignment = teachers.find((t) => t.user_id === teacherUserId)
  if (!teacherAssignment) {
    throw new Error('User is not a teacher for this session')
  }

  // Auth-plane: resolve the teacher's email via GoTrue admin API. Stays on a
  // direct Supabase client until auth is swapped out.
  const supabase = await createSupabaseServiceClient()
  const { data: userData, error: userError } =
    await supabase.auth.admin.getUserById(teacherUserId)

  if (userError || !userData.user.email) {
    throw new Error('Could not retrieve teacher email address')
  }

  const teacherEmail = userData.user.email
  const departmentName =
    (await teacherInvitationsDb.findDepartmentName(session.department_id)) || ''

  const mailer = getEmailClient()
  const subject =
    emailType === 'INVITATION'
      ? `You're invited to teach: ${session.title}`
      : `Reminder: Upcoming session - ${session.title}`

  const htmlBody = buildEmailHtml(session, departmentName, emailType)
  const fromAddress = getFromAddress()

  const { data: emailResult, error: emailError } = await mailer.emails.send({
    from: fromAddress,
    to: teacherEmail,
    subject,
    html: htmlBody,
  })

  if (emailError) {
    throw new Error(`Failed to send email: ${emailError.message}`)
  }

  try {
    await teacherEmailsDb.insertTeacherEmail({
      orgId,
      sessionId,
      userId: teacherUserId,
      emailType,
      recipientEmail: teacherEmail,
      sentBy: currentUserId,
      resendId: emailResult?.id || null,
    })
  } catch (recordError) {
    console.error('Failed to record email send:', recordError)
  }

  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

export async function getTeacherEmailHistory(sessionId: string) {
  await requireAuth()
  const orgId = await requireOrg()
  return teacherEmailsDb.listTeacherEmailsForSession(orgId, sessionId)
}

function buildEmailHtml(
  session: Session,
  departmentName: string,
  emailType: EmailType
): string {
  const startDate = new Date(session.date_start)
  const endDate = new Date(session.date_end)
  const dateStr = startDate.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const startTime = startDate.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const endTime = endDate.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const heading =
    emailType === 'INVITATION'
      ? 'You have been invited to teach a session'
      : 'This is a reminder about an upcoming session you are teaching'

  // Invitations need a response: deep-link to the dashboard Teaching tab
  // where the teacher can accept or decline.
  const respondSection =
    emailType === 'INVITATION'
      ? `<p style="margin:20px 0;">
           <a href="${getAppUrl()}/dashboard?tab=teaching" style="display:inline-block;background:#000;color:#fff;padding:10px 20px;text-decoration:none;font-weight:bold;">Respond to invitation</a>
         </p>
         <p style="font-size:12px;color:#666;">Sign in and accept the invitation to confirm you are teaching this session.</p>`
      : ''

  const teamsSection = session.teams_meeting_url
    ? `<tr>
         <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Teams Link:</td>
         <td style="padding:8px 0;">
           <a href="${session.teams_meeting_url}" style="color:#000;text-decoration:underline;">
             Join Meeting
           </a>
         </td>
       </tr>`
    : ''

  const descriptionSection = session.description
    ? `<tr>
         <td style="padding:8px 0;font-weight:bold;vertical-align:top;">Description:</td>
         <td style="padding:8px 0;">${session.description}</td>
       </tr>`
    : ''

  return `
    <div style="font-family:monospace;max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="border-bottom:2px solid #000;padding-bottom:10px;">${heading}</h2>
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
        ${teamsSection}
        ${descriptionSection}
      </table>
      ${respondSection}
      <p style="font-size:12px;color:#666;margin-top:20px;border-top:1px solid #ccc;padding-top:10px;">
        This email was sent via Byte Teaching.
      </p>
    </div>
  `
}
