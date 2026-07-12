'use server'

import { revalidatePath } from 'next/cache'
import { requireDepartmentModerator, requireOrg } from '@/lib/auth'
import { generateCertificatePDF } from '@/lib/certificates/pdf'
import { generateCertificateCode } from '@/lib/certificates/utils'
import * as attendanceDb from '@/lib/db/attendance'
import { getEmailClient, getFromAddress } from '@/lib/email'
import {
  buildCertificateEmailHtml,
  buildTeacherFeedbackEmailHtml,
} from '@/lib/email-templates'
import {
  buildFeedbackSubmission,
  extractTextResponses,
  getFeedbackSubmissionScore,
  normalizeDepartmentFeedbackFields,
  normalizeSubmittedFeedbackAnswers,
} from '@/lib/feedback-form'
import type {
  DepartmentFeedbackField,
  FeedbackAnswerInput,
  SubmittedFeedbackAnswer,
} from '@/lib/types'
import { isLlmConfigured } from '@/lib/ai/llm'
import { summarizeFeedback } from '@/lib/ai/feedback-summary'
import * as feedbackDb from '@/lib/db/feedback'
import * as onboardingDb from '@/lib/db/onboarding'
import * as sessionsDb from '@/lib/db/sessions'
import * as certificatesDb from '@/lib/db/certificates'
import { DbNotFoundError } from '@/lib/db'

export interface FeedbackData {
  firstName: string
  lastName: string
  email: string
  answers: FeedbackAnswerInput[]
}

function getFeedbackTextResponses(feedback: feedbackDb.StoredFeedbackRow) {
  const answers = normalizeSubmittedFeedbackAnswers(feedback.answers)
  const textResponses = extractTextResponses(answers)

  if (textResponses.length > 0) {
    return { answers, textResponses }
  }

  if (feedback.comment && feedback.comment.trim().length > 0) {
    return {
      answers,
      textResponses: [
        {
          label: 'Comment',
          text: feedback.comment.trim(),
        },
      ],
    }
  }

  return { answers, textResponses: [] as { label: string; text: string }[] }
}

export async function getDepartmentFeedbackFields(departmentId: string) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  const raw = await feedbackDb.findDepartmentFeedbackFormFields(departmentId, orgId)
  return normalizeDepartmentFeedbackFields(raw)
}

export async function updateDepartmentFeedbackFields(
  departmentId: string,
  fields: DepartmentFeedbackField[]
) {
  await requireDepartmentModerator(departmentId)
  const orgId = await requireOrg()

  const normalizedFields = normalizeDepartmentFeedbackFields(fields)
  if (normalizedFields.length > 24) {
    throw new Error('Feedback forms are limited to 24 fields.')
  }

  await feedbackDb.updateDepartmentFeedbackFormFields(
    departmentId,
    orgId,
    normalizedFields
  )

  revalidatePath('/settings')
  revalidatePath('/dashboard')
  revalidatePath(`/departments/${departmentId}`)
  revalidatePath(`/departments/${departmentId}/feedback`)
}

export async function submitFeedback(sessionId: string, feedback: FeedbackData) {
  const firstName = feedback.firstName.trim()
  const lastName = feedback.lastName.trim()
  const email = feedback.email.trim().toLowerCase()

  if (!firstName || !lastName || !email) {
    throw new Error('Please fill in your name and email.')
  }

  const session = await feedbackDb.findSessionForFeedbackSubmission(sessionId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  if (session.status !== 'PUBLISHED') {
    throw new Error('Feedback can only be submitted for published sessions')
  }

  const department = await feedbackDb.findDepartmentForFeedbackSubmission(
    session.department_id
  )
  if (!department) {
    throw new DbNotFoundError('Department not found')
  }

  const templateFields = normalizeDepartmentFeedbackFields(
    department.feedback_form_fields
  )
  const { submittedAnswers, derivedRating, derivedComment } = buildFeedbackSubmission(
    templateFields,
    feedback.answers || []
  )

  // Resolve user_id from email if they have a profile
  const profile = await onboardingDb.findProfileByEmail(email)
  const resolvedUserId = profile?.user_id ?? null

  const inserted = await feedbackDb.insertSessionFeedback({
    orgId: session.org_id,
    sessionId,
    userId: resolvedUserId,
    rating: derivedRating,
    comment: derivedComment,
    answers: submittedAnswers,
    firstName,
    lastName,
    email,
  })

  // Create attendance evidence — feedback submission = attended
  try {
    await attendanceDb.insertAttendanceEvidence({
      orgId: session.org_id,
      sessionId,
      departmentId: session.department_id,
      userId: resolvedUserId,
      externalEmail: resolvedUserId ? null : email,
      source: 'FEEDBACK',
      observedAt: new Date().toISOString(),
      metadata: { feedback_id: inserted.id },
      createdBy: resolvedUserId,
    })
  } catch {
    // Non-fatal — evidence creation failure shouldn't block feedback
  }

  try {
    const recipientName = `${firstName} ${lastName}`
    const orgName = await feedbackDb.findOrganizationName(session.org_id)

    if (orgName) {
      const certificateCode = generateCertificateCode()
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      const verifyUrl = `${baseUrl}/verify/${certificateCode}`

      await certificatesDb.insertCertificate({
        orgId: session.org_id,
        departmentId: session.department_id,
        sessionId,
        userId: resolvedUserId,
        role: 'ATTENDEE',
        certificateCode,
        recipientName,
      })

      const pdfBuffer = await generateCertificatePDF({
        orgName,
        departmentName: department.name,
        sessionTitle: session.title,
        sessionDate: new Date(session.date_start).toLocaleDateString('en-GB', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        recipientName,
        role: 'Attendee',
        certificateCode,
        issuedDate: new Date().toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        verifyUrl,
        leadName: department.lead_name || undefined,
      })

      const mailer = getEmailClient()
      const fromAddress = getFromAddress()
      const htmlBody = buildCertificateEmailHtml(session.title, recipientName)

      await mailer.emails.send({
        from: fromAddress,
        to: email,
        subject: `Your Attendance Certificate — ${session.title}`,
        html: htmlBody,
        attachments: [
          {
            filename: `certificate-${certificateCode}.pdf`,
            content: pdfBuffer,
          },
        ],
      })
    }
  } catch (certError) {
    console.error('Failed to generate/email certificate:', certError)
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return inserted
}

export async function getSessionFeedback(sessionId: string) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  return feedbackDb.listSessionFeedback(orgId, sessionId)
}

export async function getSessionFeedbackStats(sessionId: string) {
  const feedback = await getSessionFeedback(sessionId)

  const total = feedback.length
  const submissionScores: number[] = []
  const ratingDistribution = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  }

  const questionSummaries = new Map<
    string,
    {
      fieldId: string
      label: string
      ratings: number[]
      commentsCount: number
    }
  >()

  const comments = feedback.flatMap((entry) => {
    const { answers, textResponses } = getFeedbackTextResponses(entry)
    const submissionScore = getFeedbackSubmissionScore(answers, entry.rating)

    if (submissionScore !== null) {
      submissionScores.push(submissionScore)
      const bucket = Math.min(5, Math.max(1, Math.round(submissionScore))) as
        | 1
        | 2
        | 3
        | 4
        | 5
      ratingDistribution[bucket] += 1
    }

    const scoredAnswers = answers.filter(
      (answer): answer is SubmittedFeedbackAnswer & { value: string } =>
        answer.type === 'rating' && Boolean(answer.value)
    )

    if (scoredAnswers.length > 0) {
      scoredAnswers.forEach((answer) => {
        const existing = questionSummaries.get(answer.fieldId) || {
          fieldId: answer.fieldId,
          label: answer.label,
          ratings: [],
          commentsCount: 0,
        }

        existing.ratings.push(Number(answer.value))
        if (answer.comment) {
          existing.commentsCount += 1
        }

        questionSummaries.set(answer.fieldId, existing)
      })
    } else if (entry.rating) {
      const existing = questionSummaries.get('overall_session_rating') || {
        fieldId: 'overall_session_rating',
        label: 'Overall session rating',
        ratings: [],
        commentsCount: 0,
      }

      existing.ratings.push(entry.rating)
      if (textResponses.length > 0) {
        existing.commentsCount += textResponses.length
      }

      questionSummaries.set('overall_session_rating', existing)
    }

    if (textResponses.length === 0) {
      return []
    }

    return [
      {
        id: entry.id,
        rating:
          submissionScore !== null
            ? Math.round(submissionScore * 10) / 10
            : entry.rating,
        created_at: entry.created_at,
        responses: textResponses,
      },
    ]
  })

  const averageRating =
    submissionScores.length > 0
      ? Math.round(
          (submissionScores.reduce((sum, score) => sum + score, 0) /
            submissionScores.length) *
            10
        ) / 10
      : 0

  return {
    total,
    averageRating,
    ratingDistribution,
    commentsCount: comments.reduce((sum, entry) => sum + entry.responses.length, 0),
    comments,
    questionSummaries: Array.from(questionSummaries.values()).map((summary) => {
      const average =
        summary.ratings.length > 0
          ? Math.round(
              (summary.ratings.reduce((sum, rating) => sum + rating, 0) /
                summary.ratings.length) *
                10
            ) / 10
          : 0

      return {
        fieldId: summary.fieldId,
        label: summary.label,
        averageRating: average,
        responseCount: summary.ratings.length,
        commentsCount: summary.commentsCount,
      }
    }),
  }
}

export async function getSessionFeedbackAudit(sessionId: string) {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(scope.department_id)

  const rows = await feedbackDb.listSessionFeedbackAudit(sessionId)
  return rows.map((entry) => ({
    ...entry,
    answers: normalizeSubmittedFeedbackAnswers(entry.answers),
  }))
}

export async function releaseTeacherFeedback(sessionId: string) {
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const [orgName, department, feedbackStats] = await Promise.all([
    feedbackDb.findOrganizationName(orgId),
    feedbackDb.findDepartmentForFeedbackSubmission(session.department_id),
    getSessionFeedbackStats(sessionId),
  ])

  if (!orgName || !department) {
    throw new DbNotFoundError('Organization or department not found')
  }

  const feedbackComments = await feedbackDb.listSessionFeedbackComments(sessionId)
  const comments = feedbackComments
    .filter((entry) => entry.comment && entry.comment.trim().length > 0)
    .map((entry) => ({
      attendee_first_name: entry.attendee_first_name,
      attendee_last_name: entry.attendee_last_name,
      comment: entry.comment!,
    }))

  const [externalTeachers, registeredTeachers] = await Promise.all([
    feedbackDb.listAcceptedTeacherInvitations(sessionId),
    feedbackDb.listRegisteredSessionTeachers(sessionId),
  ])

  const registeredTeacherDetails: { email: string; name: string; userId: string }[] = []
  for (const teacher of registeredTeachers) {
    const profile = await feedbackDb.findTeacherProfile(teacher.user_id)
    if (profile?.email) {
      registeredTeacherDetails.push({
        email: profile.email,
        name: profile.full_name || profile.email,
        userId: teacher.user_id,
      })
    }
  }

  const allTeachers = [
    ...externalTeachers.map((teacher) => ({
      email: teacher.email,
      name: `${teacher.first_name} ${teacher.last_name}`,
      userId: null as string | null,
    })),
    ...registeredTeacherDetails.map((teacher) => ({
      email: teacher.email,
      name: teacher.name,
      userId: teacher.userId as string | null,
    })),
  ]

  if (allTeachers.length === 0) {
    throw new Error('No teachers found for this session')
  }

  const sessionDate = new Date(session.date_start).toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  let sentCount = 0

  for (const teacher of allTeachers) {
    try {
      const certificateCode = generateCertificateCode()
      const verifyUrl = `${baseUrl}/verify/${certificateCode}`

      await certificatesDb.insertCertificate({
        orgId,
        departmentId: session.department_id,
        sessionId,
        userId: teacher.userId,
        role: 'TEACHER',
        certificateCode,
        recipientName: teacher.name,
      })

      const pdfBuffer = await generateCertificatePDF({
        orgName,
        departmentName: department.name,
        sessionTitle: session.title,
        sessionDate,
        recipientName: teacher.name,
        role: 'Teacher',
        certificateCode,
        issuedDate: new Date().toLocaleDateString('en-GB', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        verifyUrl,
        leadName: department.lead_name || undefined,
      })

      const html = buildTeacherFeedbackEmailHtml({
        teacherName: teacher.name,
        sessionTitle: session.title,
        sessionDate,
        departmentName: department.name,
        totalResponses: feedbackStats.total,
        averageRating: feedbackStats.averageRating,
        ratingDistribution: feedbackStats.ratingDistribution,
        comments,
      })

      await mailer.emails.send({
        from: fromAddress,
        to: teacher.email,
        subject: `Teaching Feedback Released — ${session.title}`,
        html,
        attachments: [
          {
            filename: `teacher-certificate-${certificateCode}.pdf`,
            content: pdfBuffer,
          },
        ],
      })

      sentCount += 1
    } catch (error) {
      console.error(`Failed to send teacher feedback to ${teacher.email}:`, error)
    }
  }

  // -----------------------------------------------------------------------
  // Teacher attendance: ensure all teachers have TEACHER evidence
  // -----------------------------------------------------------------------
  for (const teacher of allTeachers) {
    if (!teacher.userId) continue
    try {
      await attendanceDb.insertAttendanceEvidence({
        orgId,
        sessionId,
        departmentId: session.department_id,
        userId: teacher.userId,
        externalEmail: null,
        source: 'TEACHER',
        observedAt: session.date_start,
        metadata: { assigned_as_teacher: true },
        createdBy: null,
      })
    } catch {
      // Evidence may already exist — non-fatal
    }
  }

  // -----------------------------------------------------------------------
  // Trainee reports: send attendance report + certificate to each attendee
  // -----------------------------------------------------------------------
  // Get attendees with PRESENT status (teachers excluded — they got their email above)
  const attendeeIds = await feedbackDb.listPresentAttendeeUserIds(sessionId)
  const attendeeProfiles = new Map(
    (await onboardingDb.listProfilesForUsers(attendeeIds)).map((p) => [p.user_id, p])
  )

  let traineesSent = 0
  const teacherUserIds = new Set(allTeachers.filter((t) => t.userId).map((t) => t.userId))

  if (attendeeIds.length > 0) {
    for (const attendeeUserId of attendeeIds) {
      if (teacherUserIds.has(attendeeUserId)) continue

      try {
        const profile = attendeeProfiles.get(attendeeUserId)
        if (!profile?.email) continue

        const recipientName =
          profile.full_name ||
          [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
          profile.email

        // Generate or find certificate
        const existingCert = await certificatesDb.findCertificateByUserAndSession(
          attendeeUserId, sessionId
        )

        let certCode: string
        if (existingCert) {
          certCode = existingCert.certificate_code
        } else {
          certCode = generateCertificateCode()
          await certificatesDb.insertCertificate({
            orgId,
            departmentId: session.department_id,
            sessionId,
            userId: attendeeUserId,
            role: 'ATTENDEE',
            certificateCode: certCode,
            recipientName,
          })
        }

        const traineeHtml = buildCertificateEmailHtml(session.title, recipientName)

        await mailer.emails.send({
          from: fromAddress,
          to: profile.email,
          subject: `Your Attendance Certificate — ${session.title}`,
          html: traineeHtml,
        })

        traineesSent++
      } catch (err) {
        console.error(`Failed to send trainee certificate to ${attendeeUserId}:`, err)
      }
    }
  }

  // Mark session report as sent
  await sessionsDb.markSessionReportSent(sessionId)

  revalidatePath(`/sessions/${sessionId}/manage`)

  return {
    sentCount,
    totalTeachers: allTeachers.length,
    traineesSent,
  }
}

/**
 * AI summary of a session's anonymous feedback (moderators only).
 * Returns { summary: null, error } when unconfigured or empty rather than
 * throwing, so the panel can render a friendly message.
 */
export async function summarizeSessionFeedback(
  sessionId: string
): Promise<{ summary: string | null; error: string | null }> {
  const orgId = await requireOrg()

  const scope = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!scope) {
    throw new DbNotFoundError('Session not found')
  }
  await requireDepartmentModerator(scope.department_id)

  const session = await sessionsDb.getSessionOrThrow(sessionId, orgId)
  const feedback = await feedbackDb.listSessionFeedback(orgId, sessionId)

  if (feedback.length === 0) {
    return { summary: null, error: 'No feedback has been submitted yet.' }
  }

  if (!isLlmConfigured()) {
    return {
      summary: null,
      error: 'AI summaries are not configured — set OPENAI_API_KEY on the server.',
    }
  }

  try {
    const summary = await summarizeFeedback({
      sessionTitle: session.title,
      rows: feedback,
    })
    if (!summary) {
      return { summary: null, error: 'The AI returned an empty summary. Try again.' }
    }
    return { summary, error: null }
  } catch (err) {
    console.error(`Failed to summarize feedback for session ${sessionId}:`, err)
    return {
      summary: null,
      error: err instanceof Error ? err.message : 'Failed to generate the summary.',
    }
  }
}
