'use server'

import { revalidatePath } from 'next/cache'
import { createHash, randomUUID } from 'node:crypto'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import { getEmailClient, getFromAddress } from '@/lib/email'
import { buildTeacherFeedbackEmailHtml } from '@/lib/email-templates'
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
import { isFeedbackWindowOpen } from '@/lib/feedback-window'
import { formatInAppTimeZone } from '@/lib/datetime'
import { isLlmConfigured } from '@/lib/ai/llm'
import { summarizeFeedback } from '@/lib/ai/feedback-summary'
import * as feedbackDb from '@/lib/db/feedback'
import * as onboardingDb from '@/lib/db/onboarding'
import * as sessionsDb from '@/lib/db/sessions'
import * as feedbackReportsDb from '@/lib/db/feedback-reports'
import * as deliveriesDb from '@/lib/db/session-deliveries'
import { DbConflictError, DbNotFoundError } from '@/lib/db'

export interface FeedbackData {
  firstName: string
  lastName: string
  email: string
  answers: FeedbackAnswerInput[]
}

interface ApprovedQuestionSummary {
  fieldId: string
  label: string
  averageRating: number
  responseCount: number
  commentsCount: number
}

function readApprovedQuestionSummaries(value: unknown): ApprovedQuestionSummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const row = entry as Record<string, unknown>
    if (
      typeof row.fieldId !== 'string' ||
      typeof row.label !== 'string' ||
      typeof row.averageRating !== 'number' ||
      typeof row.responseCount !== 'number' ||
      typeof row.commentsCount !== 'number'
    ) {
      return []
    }
    return [{
      fieldId: row.fieldId,
      label: row.label,
      averageRating: row.averageRating,
      responseCount: row.responseCount,
      commentsCount: row.commentsCount,
    }]
  })
}

function readApprovedRatingDistribution(value: unknown): Record<number, number> {
  if (!value || typeof value !== 'object') return {}
  const distribution: Record<number, number> = {}
  for (const [rating, count] of Object.entries(value as Record<string, unknown>)) {
    if (/^[1-5]$/.test(rating) && typeof count === 'number') {
      distribution[Number(rating)] = count
    }
  }
  return distribution
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

// Next.js masks thrown action errors in production, so this public action
// returns expected failures for the form to show; only unexpected ones throw.
// `final` (window closed) tells the form to refresh into the page's closed notice.
export type SubmitFeedbackResult =
  | { ok: true; id: string }
  | { ok: false; message: string; final?: true }

export async function submitFeedback(
  sessionId: string,
  feedback: FeedbackData
): Promise<SubmitFeedbackResult> {
  const firstName = feedback.firstName.trim()
  const lastName = feedback.lastName.trim()
  const email = feedback.email.trim().toLowerCase()

  if (!firstName || !lastName || !email) {
    return { ok: false, message: 'Please fill in your name and email.' }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' }
  }

  const session = await feedbackDb.findSessionForFeedbackSubmission(sessionId)
  if (!session) {
    return { ok: false, message: 'This session is no longer available for feedback.' }
  }

  if (session.status !== 'PUBLISHED') {
    return { ok: false, message: 'Feedback can only be submitted for published sessions' }
  }

  if (!isFeedbackWindowOpen(session)) {
    return { ok: false, message: 'The feedback window for this session is closed', final: true }
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
  let submission: ReturnType<typeof buildFeedbackSubmission>
  try {
    submission = buildFeedbackSubmission(templateFields, feedback.answers || [])
  } catch (error) {
    // The validator throws plain Errors with answer-level messages; a
    // TypeError etc. means malformed input and stays a generic failure.
    if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype) {
      return { ok: false, message: error.message }
    }
    throw error
  }
  const { submittedAnswers, derivedRating, derivedComment } = submission

  // Resolve user_id from email if they have a profile
  const profile = await onboardingDb.findProfileByEmail(email)
  const resolvedUserId = profile?.user_id ?? null

  let inserted: { id: string }
  try {
    inserted = await feedbackDb.insertSessionFeedback({
      orgId: session.org_id,
      sessionId,
      userId: resolvedUserId,
      rating: derivedRating,
      comment: derivedComment,
      answers: submittedAnswers,
      firstName,
      lastName,
      email,
      submissionKey: createHash('sha256').update(email).digest('hex'),
    })
  } catch (error) {
    if (error instanceof DbConflictError) {
      return { ok: false, message: 'Feedback has already been submitted for this email address' }
    }
    throw error
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { ok: true, id: inserted.id }
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

export async function releaseTeacherFeedback(
  sessionId: string,
  reviewedSummaryInput?: string
) {
  const actorUserId = await requireAuth()
  const orgId = await requireOrg()

  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) {
    throw new DbNotFoundError('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const [department, feedbackStats] = await Promise.all([
    feedbackDb.findDepartmentForFeedbackSubmission(session.department_id),
    getSessionFeedbackStats(sessionId),
  ])

  if (!department) {
    throw new DbNotFoundError('Department not found')
  }

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

  const teacherCandidates = [
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
  const allTeachers = Array.from(
    new Map(
      teacherCandidates.map((teacher) => [teacher.email.trim().toLowerCase(), teacher])
    ).values()
  )

  if (allTeachers.length === 0) {
    throw new Error('No teachers found for this session')
  }

  const sessionDate = formatInAppTimeZone(session.date_start, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const mailer = getEmailClient()
  const fromAddress = getFromAddress()
  let sentCount = 0
  let previouslyDeliveredCount = 0
  let inProgressCount = 0
  const failures: { email: string; message: string }[] = []
  const providerReceipts: { email: string; id: string }[] = []
  // A non-empty feedback set can be summarized and released. The snapshot is
  // suppressed only when there is no evidence to report at all.
  const privacySuppressed = feedbackStats.total === 0
  const reviewedSummary = reviewedSummaryInput?.trim()
  if (reviewedSummary && reviewedSummary.length > 4000) {
    throw new Error('The reviewed teaching summary is limited to 4,000 characters.')
  }
  if (privacySuppressed && reviewedSummary) {
    throw new Error('A reviewed teaching narrative requires at least one feedback response.')
  }
  const report = await feedbackReportsDb.createApprovedTeacherFeedbackReport({
    orgId,
    departmentId: session.department_id,
    sessionId,
    actorUserId,
    responseCount: feedbackStats.total,
    privacySuppressed,
    analyticsSnapshot: {
      total: feedbackStats.total,
      averageRating: privacySuppressed ? null : feedbackStats.averageRating,
      ratingDistribution: privacySuppressed ? null : feedbackStats.ratingDistribution,
      questionSummaries: privacySuppressed ? [] : feedbackStats.questionSummaries,
      ...(reviewedSummary ? { reviewedSummary } : {}),
    },
    preserveLatestReviewedSummary: reviewedSummaryInput === undefined,
  })
  const resend = report.alreadyReleased
  const attemptId = randomUUID()
  const approvedSnapshot = report.analytics_snapshot
  const approvedTotal =
    typeof approvedSnapshot.total === 'number'
      ? approvedSnapshot.total
      : report.response_count
  const approvedAverage =
    typeof approvedSnapshot.averageRating === 'number'
      ? approvedSnapshot.averageRating
      : 0
  const approvedDistribution = readApprovedRatingDistribution(
    approvedSnapshot.ratingDistribution
  )
  const approvedQuestions = readApprovedQuestionSummaries(
    approvedSnapshot.questionSummaries
  )
  const approvedSummary =
    !report.privacy_suppressed &&
    typeof approvedSnapshot.reviewedSummary === 'string'
      ? approvedSnapshot.reviewedSummary
      : null

  for (const teacher of allTeachers) {
    let deliveryId: string | null = null
    let deliveryClaimed = false
    let publicFailureMessage = 'Petrios could not start this delivery attempt.'
    try {
      const html = buildTeacherFeedbackEmailHtml({
        teacherName: teacher.name,
        sessionTitle: session.title,
        sessionDate,
        departmentName: department.name,
        totalResponses: approvedTotal,
        averageRating: approvedAverage,
        ratingDistribution: approvedDistribution,
        questionSummaries: approvedQuestions,
        reviewedSummary: approvedSummary,
        privacySuppressed: report.privacy_suppressed,
      })

      const delivery = await deliveriesDb.getOrCreateSessionDelivery({
        orgId,
        departmentId: session.department_id,
        sessionId,
        recipientUserId: teacher.userId,
        recipientEmail: teacher.email,
        deliveryType: 'TEACHER_FEEDBACK_REPORT',
        relatedId: report.id,
      })
      deliveryId = delivery.id
      if (delivery.status === 'SENT' && !resend) {
        previouslyDeliveredCount += 1
        continue
      }
      if (
        !(await deliveriesDb.claimSessionDelivery(delivery.id, {
          allowPreviouslySent: resend,
        }))
      ) {
        inProgressCount += 1
        continue
      }
      deliveryClaimed = true
      const result = await mailer.emails.send({
        from: fromAddress,
        to: teacher.email,
        subject: `Teaching Feedback Released — ${session.title}`,
        html,
      })
      if (result.error) {
        publicFailureMessage = result.error.message
        throw new Error(result.error.message)
      }
      if (!result.data?.id) {
        publicFailureMessage =
          'The email transport did not return a provider receipt, so Petrios did not record this attempt as sent.'
        throw new Error(publicFailureMessage)
      }
      publicFailureMessage =
        'The provider accepted the email, but Petrios could not record the receipt. Retrying may send another copy.'
      await deliveriesDb.recordDeliveryAttempt({
        id: delivery.id,
        success: true,
        providerMessageId: result.data.id,
      })

      sentCount += 1
      providerReceipts.push({ email: teacher.email, id: result.data.id })
    } catch (error) {
      console.error(`Failed to send teacher feedback to ${teacher.email}:`, error)
      failures.push({
        email: teacher.email,
        message: publicFailureMessage,
      })
      if (deliveryId && deliveryClaimed) {
        await deliveriesDb.recordDeliveryAttempt({
          id: deliveryId,
          success: false,
          error: error instanceof Error ? error.message : 'Feedback report delivery failed',
        }).catch((deliveryError) => {
          console.error('Failed to record teacher feedback delivery failure:', deliveryError)
        })
      }
    }
  }

  if (inProgressCount > 0) {
    return {
      sentCount,
      totalTeachers: allTeachers.length,
      failedCount: failures.length,
      failures,
      providerReceipts,
      privacySuppressed: report.privacy_suppressed,
      includedReviewedSummary: Boolean(approvedSummary),
      resend,
      previouslyDeliveredCount,
      inProgressCount,
    }
  }

  await feedbackReportsDb.finishTeacherFeedbackReport({
    reportId: report.id,
    released: failures.length === 0,
    resend,
    attemptId,
    orgId,
    departmentId: session.department_id,
    sessionId,
    actorUserId,
    sentCount,
    failedCount: failures.length,
  })

  revalidatePath(`/sessions/${sessionId}/manage`)

  return {
    sentCount,
    totalTeachers: allTeachers.length,
    failedCount: failures.length,
    failures,
    providerReceipts,
    privacySuppressed: report.privacy_suppressed,
    includedReviewedSummary: Boolean(approvedSummary),
    resend,
    previouslyDeliveredCount,
    inProgressCount: 0,
  }
}

/**
 * AI summary of a session's identified feedback with stored identity fields
 * omitted from the model input (moderators only).
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

  const [session, feedback, feedbackStats] = await Promise.all([
    sessionsDb.getSessionOrThrow(sessionId, orgId),
    feedbackDb.listSessionFeedback(orgId, sessionId),
    getSessionFeedbackStats(sessionId),
  ])

  if (feedback.length === 0) {
    return { summary: null, error: 'No feedback has been submitted yet.' }
  }

  if (!isLlmConfigured()) {
    return {
      summary: null,
      error: 'AI summaries are not configured — set ANTHROPIC_API_KEY (or OPENAI_API_KEY) on the server.',
    }
  }

  try {
    const summary = await summarizeFeedback({
      sessionTitle: session.title,
      rows: feedback,
      questionSummaries: feedbackStats.questionSummaries,
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
