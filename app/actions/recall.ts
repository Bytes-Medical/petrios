'use server'

import { revalidatePath } from 'next/cache'
import {
  getCurrentUser,
  requireAuth,
  requireDepartmentModerator,
  requireOrg,
} from '@/lib/auth'
import {
  RecallQuestionSetSchema,
  scoreAnswers,
  verifyRecallToken,
  type RecallQuestion,
} from '@/lib/recall'
import * as recallDb from '@/lib/db/recall'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import * as audioRecapsDb from '@/lib/db/audio-recaps'
import * as certificatesDb from '@/lib/db/certificates'
import type { RecallQuestionSet } from '@/lib/db/recall'
import { computeRetentionAnalytics, type RetentionAnalytics } from '@/lib/recall-analytics'
import { awardRecallCompletion } from '@/lib/recall-awards'

/**
 * Petrios Recall actions. Moderator surface (review/edit/approve question
 * sets) is requireDepartmentModerator-gated. The learner route is reachable
 * from an HMAC deep link, but playback and answers additionally require the
 * authenticated user named by that link.
 */

export async function getRecallSetForSession(
  sessionId: string
): Promise<RecallQuestionSet | null> {
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)

  return recallDb.findSetForSession(sessionId)
}

/**
 * Aggregate Recall outcome analytics for the Recall tab. Moderator-only, and
 * aggregates-only by construction: the DAL feed carries no user ids and the
 * pure computation suppresses any cohort under RETENTION_MIN_COHORT before
 * the result leaves the server. Current UI emphasizes final catch-up outcomes;
 * legacy attendee-retention rows remain countable. Individual performance is
 * never exposed.
 */
export async function getRecallAnalytics(sessionId: string): Promise<RetentionAnalytics> {
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)

  const stats = await recallDb.listAnswerStatsForSession(sessionId)
  return computeRetentionAnalytics(stats, session.date_end, null)
}

export async function saveRecallQuestions(
  sessionId: string,
  questions: RecallQuestion[],
  approve: boolean
): Promise<{ success: true }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)

  const parsed = RecallQuestionSetSchema.safeParse({ questions })
  if (!parsed.success) {
    throw new Error('Questions are invalid: each needs text, 4 options, a correct answer, and an explanation')
  }

  const set = await recallDb.findSetForSession(sessionId)
  if (!set) throw new Error('No question set drafted for this session yet')
  if (set.status === 'approved') {
    throw new Error('Recall the published questions before editing them')
  }

  if (approve) {
    const recap = await audioRecapsDb.findRecapForSession(sessionId)
    if (
      !recap ||
      recap.status !== 'approved' ||
      !recap.audio_bytes ||
      !recap.script_digest ||
      recap.script_digest !== set.script_digest
    ) {
      throw new Error('Approve the matching current Audio Recap before publishing its questions')
    }
    if (session.attendance_phase !== 'FINALIZED') {
      throw new Error('Finalize attendance before publishing the absentee catch-up package')
    }
  }

  await recallDb.updateSetQuestions({
    setId: set.id,
    questions: parsed.data.questions,
    approve,
    userId,
  })
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

export async function recallPublishedQuestions(sessionId: string): Promise<{ success: true }> {
  await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)
  const set = await recallDb.findSetForSession(sessionId)
  if (!set || !(await recallDb.recallPublishedSet(set.id))) {
    throw new Error('Only published Recall questions can be recalled')
  }
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Authenticated learner flow (HMAC deep link + matching account)
// ---------------------------------------------------------------------------

/** Question shape safe to ship to the browser BEFORE submission. */
export interface PublicRecallQuestion {
  question: string
  options: string[]
}

export interface RecallPageState {
  valid: boolean
  reason?:
    | 'invalid'
    | 'auth-required'
    | 'wrong-account'
    | 'not-ready'
    | 'closed'
    | 'not-eligible'
    | 'attempts-exhausted'
  sessionTitle?: string
  sessionId?: string
  audioUrl?: string
  playback?: {
    completed: boolean
    listenedSeconds: number
    durationSeconds: number
  }
  questions?: PublicRecallQuestion[]
  attemptsRemaining?: number
  completion?: { awardStatus: recallDb.RecallCompletion['award_status'] }
}

export async function getRecallForToken(token: string): Promise<RecallPageState> {
  const verified = verifyRecallToken(token)
  if (!verified) return { valid: false, reason: 'invalid' }

  const user = await getCurrentUser()
  if (!user) return { valid: false, reason: 'auth-required' }
  if (user.id !== verified.userId) return { valid: false, reason: 'wrong-account' }

  const [session, set, recap, attendance, completion, acceptedTeacher, expectedAttendee] = await Promise.all([
    sessionsDb.findPublishedSessionWithFeedbackFields(verified.sessionId),
    recallDb.findSetForSession(verified.sessionId),
    audioRecapsDb.findRecapForSession(verified.sessionId),
    attendanceDb.findAttendanceForUserAsSystem(verified.sessionId, verified.userId),
    recallDb.findCompletion(verified.sessionId, verified.userId),
    certificatesDb.userIsAcceptedTeacherAsSystem(verified.sessionId, verified.userId),
    attendanceDb.isExpectedAttendeeAsSystem(verified.sessionId, verified.userId),
  ])

  if (
    !session ||
    !set ||
    set.status !== 'approved' ||
    set.questions.length !== 5 ||
    !set.script_digest ||
    !recap ||
    recap.status !== 'approved' ||
    !recap.audio_bytes ||
    !recap.audio_duration_seconds ||
    recap.script_digest !== set.script_digest ||
    session.attendance_phase !== 'FINALIZED' ||
    (session.attendance_policy_version ?? 1) < 2
  ) {
    return { valid: false, reason: 'not-ready' }
  }

  if (completion) {
    return {
      valid: true,
      sessionTitle: session.title,
      sessionId: session.id,
      completion: { awardStatus: completion.award_status },
    }
  }

  const now = Date.now()
  if (
    !set.catchup_opens_at ||
    !set.catchup_closes_at ||
    now < new Date(set.catchup_opens_at).getTime() ||
    now > new Date(set.catchup_closes_at).getTime()
  ) {
    return { valid: false, reason: 'closed', sessionTitle: session.title }
  }

  if (!expectedAttendee || acceptedTeacher || attendance?.status !== 'ABSENT') {
    return { valid: false, reason: 'not-eligible', sessionTitle: session.title }
  }

  const [playback, attempts] = await Promise.all([
    recallDb.findPlaybackProgress(set.id, user.id),
    recallDb.listAttempts(set.id, user.id),
  ])
  const attemptsRemaining = Math.max(0, 3 - attempts.length)
  if (attemptsRemaining === 0) {
    return { valid: false, reason: 'attempts-exhausted', sessionTitle: session.title }
  }
  const playbackCompleted = Boolean(playback?.completed_at)

  return {
    valid: true,
    sessionTitle: session.title,
    sessionId: session.id,
    audioUrl: `/api/recall/${encodeURIComponent(token)}/audio`,
    playback: {
      completed: playbackCompleted,
      listenedSeconds: playback?.listened_seconds ?? 0,
      durationSeconds: recap.audio_duration_seconds,
    },
    attemptsRemaining,
    // Never ship answer_index/explanation before submission. The questions
    // themselves remain locked until server-accepted playback completes.
    questions: playbackCompleted
      ? set.questions.map((q) => ({ question: q.question, options: q.options }))
      : undefined,
  }
}

export async function recordRecallPlayback(
  token: string,
  positionSeconds: number,
  isPlaying: boolean,
  finished = false
): Promise<{ completed: boolean; listenedSeconds: number }> {
  const verified = verifyRecallToken(token)
  if (!verified) throw new Error('This recall link is not valid')
  const user = await getCurrentUser()
  if (!user) throw new Error('Sign in before listening to this recap')
  if (user.id !== verified.userId) throw new Error('This recall link belongs to another account')
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 7200) {
    throw new Error('Invalid playback position')
  }

  const set = await recallDb.findSetForSession(verified.sessionId)
  if (!set || set.status !== 'approved') throw new Error('This catch-up package is not published')
  const progress = await recallDb.recordPlaybackProgress({
    questionSetId: set.id,
    userId: user.id,
    positionSeconds,
    isPlaying,
    finished,
  })
  return {
    completed: Boolean(progress.completed_at),
    listenedSeconds: progress.listened_seconds,
  }
}

export interface RecallSubmitResult {
  score: number
  total: number
  passed: boolean
  kind: 'RETENTION' | 'CATCH_UP'
  caughtUp: boolean
  attendanceLocked: boolean
  attemptsRemaining: number
  awardStatus?: recallDb.RecallCompletion['award_status']
  review: { question: string; correct: string; explanation: string; wasCorrect: boolean }[]
}

export async function submitRecallAnswers(
  token: string,
  answers: number[]
): Promise<RecallSubmitResult> {
  const verified = verifyRecallToken(token)
  if (!verified) throw new Error('This recall link is not valid')

  const user = await getCurrentUser()
  if (!user) throw new Error('Sign in before answering these questions')
  if (user.id !== verified.userId) throw new Error('This recall link belongs to another account')
  if (
    answers.length !== 5 ||
    answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer > 3)
  ) {
    throw new Error('Answer all five questions')
  }

  const [session, set, recap, completion] = await Promise.all([
    sessionsDb.findPublishedSessionWithFeedbackFields(verified.sessionId),
    recallDb.findSetForSession(verified.sessionId),
    audioRecapsDb.findRecapForSession(verified.sessionId),
    recallDb.findCompletion(verified.sessionId, verified.userId),
  ])
  if (completion) throw new Error('You have already completed this catch-up')
  if (
    !session ||
    !set ||
    set.status !== 'approved' ||
    set.questions.length !== 5 ||
    !set.script_digest ||
    !recap ||
    recap.status !== 'approved' ||
    recap.script_digest !== set.script_digest ||
    session.attendance_phase !== 'FINALIZED' ||
    (session.attendance_policy_version ?? 1) < 2
  ) {
    throw new Error('These recall questions are not available')
  }

  const now = Date.now()
  if (
    !set.catchup_opens_at ||
    !set.catchup_closes_at ||
    now < new Date(set.catchup_opens_at).getTime() ||
    now > new Date(set.catchup_closes_at).getTime()
  ) {
    throw new Error('The answer window for this session has closed')
  }

  const [attendance, acceptedTeacher, expectedAttendee, playback, attempts] = await Promise.all([
    attendanceDb.findAttendanceForUserAsSystem(verified.sessionId, user.id),
    certificatesDb.userIsAcceptedTeacherAsSystem(verified.sessionId, user.id),
    attendanceDb.isExpectedAttendeeAsSystem(verified.sessionId, user.id),
    recallDb.findPlaybackProgress(set.id, user.id),
    recallDb.listAttempts(set.id, user.id),
  ])
  if (!expectedAttendee || acceptedTeacher || attendance?.status !== 'ABSENT') {
    throw new Error('This catch-up route is only for registered attendees marked absent')
  }
  if (!playback?.completed_at) throw new Error('Finish the Audio Recap before answering')
  if (attempts.length >= 3) throw new Error('All three attempts have been used')

  const { score, total, passed } = scoreAnswers(set.questions, answers)
  const attempt = await recallDb.insertAttempt({
    orgId: session.org_id,
    sessionId: session.id,
    questionSetId: set.id,
    playbackId: playback.id,
    userId: user.id,
    attemptNumber: attempts.length + 1,
    answers,
    score,
    passed,
  })
  const attemptsRemaining = Math.max(0, 3 - attempt.attempt_number)

  // Keep the original aggregate-only Recall analytics feed populated with the
  // final outcome. This is best-effort where a legacy answer already exists.
  if (passed || attemptsRemaining === 0) {
    await recallDb.insertAnswer({
      orgId: session.org_id,
      sessionId: session.id,
      userId: user.id,
      kind: 'CATCH_UP',
      answers,
      score,
      total,
      passed,
    }).catch(() => undefined)
  }

  let awardStatus: recallDb.RecallCompletion['award_status'] | undefined
  if (passed) {
    const recognized = await recallDb.completeCatchup({
      questionSetId: set.id,
      userId: user.id,
      perfectAttemptId: attempt.id,
    })
    awardStatus = recognized.award_status
    try {
      const awarded = await awardRecallCompletion(recognized)
      awardStatus = awarded.award_status
    } catch (error) {
      console.error('Immediate recall certificate delivery failed; cron will retry:', error)
    }
  }

  const revealReview = passed || attemptsRemaining === 0

  return {
    score,
    total,
    passed,
    kind: 'CATCH_UP',
    caughtUp: passed,
    attendanceLocked: false,
    attemptsRemaining,
    awardStatus,
    review: revealReview
      ? set.questions.map((q, i) => ({
          question: q.question,
          correct: q.options[q.answer_index],
          explanation: q.explanation,
          wasCorrect: answers[i] === q.answer_index,
        }))
      : [],
  }
}
