'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import {
  RecallQuestionSetSchema,
  scoreAnswers,
  verifyRecallToken,
  type RecallQuestion,
} from '@/lib/recall'
import {
  computeAttendanceFromEvidence,
  isWithinEvidenceWindow,
} from '@/lib/attendance/compute'
import * as recallDb from '@/lib/db/recall'
import * as sessionsDb from '@/lib/db/sessions'
import * as attendanceDb from '@/lib/db/attendance'
import type { RecallQuestionSet } from '@/lib/db/recall'

/**
 * Petrios Recall actions. Moderator surface (review/edit/approve question
 * sets) is requireDepartmentModerator-gated; the answer surface is public
 * and authorized by the HMAC capability token from the recall email (the
 * same trust model as slot claim links).
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

  await recallDb.updateSetQuestions({
    setId: set.id,
    questions: parsed.data.questions,
    approve,
    userId,
  })
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

// ---------------------------------------------------------------------------
// Public answer flow (capability token)
// ---------------------------------------------------------------------------

/** Question shape safe to ship to the browser BEFORE submission. */
export interface PublicRecallQuestion {
  question: string
  options: string[]
}

export interface RecallPageState {
  valid: boolean
  reason?: 'invalid' | 'not-ready' | 'closed' | 'answered'
  sessionTitle?: string
  questions?: PublicRecallQuestion[]
  previousResult?: { score: number; total: number; passed: boolean; kind: string }
}

export async function getRecallForToken(token: string): Promise<RecallPageState> {
  const verified = verifyRecallToken(token)
  if (!verified) return { valid: false, reason: 'invalid' }

  const [session, set, existing] = await Promise.all([
    sessionsDb.findSessionById(verified.sessionId),
    recallDb.findSetForSession(verified.sessionId),
    recallDb.findAnswer(verified.sessionId, verified.userId),
  ])

  if (!session || !set || set.status !== 'approved') {
    return { valid: false, reason: 'not-ready' }
  }
  if (existing) {
    return {
      valid: false,
      reason: 'answered',
      sessionTitle: session.title,
      previousResult: {
        score: existing.score,
        total: existing.total,
        passed: existing.passed,
        kind: existing.kind,
      },
    }
  }
  if (!isWithinEvidenceWindow('RECALL', new Date(), session)) {
    return { valid: false, reason: 'closed', sessionTitle: session.title }
  }

  return {
    valid: true,
    sessionTitle: session.title,
    // Never ship answer_index/explanation before submission.
    questions: set.questions.map((q) => ({ question: q.question, options: q.options })),
  }
}

export interface RecallSubmitResult {
  score: number
  total: number
  passed: boolean
  kind: 'RETENTION' | 'CATCH_UP'
  caughtUp: boolean
  attendanceLocked: boolean
  review: { question: string; correct: string; explanation: string; wasCorrect: boolean }[]
}

export async function submitRecallAnswers(
  token: string,
  answers: number[]
): Promise<RecallSubmitResult> {
  const verified = verifyRecallToken(token)
  if (!verified) throw new Error('This recall link is not valid')

  const [session, set, existing] = await Promise.all([
    sessionsDb.findSessionById(verified.sessionId),
    recallDb.findSetForSession(verified.sessionId),
    recallDb.findAnswer(verified.sessionId, verified.userId),
  ])
  if (!session || !set || set.status !== 'approved') {
    throw new Error('These recall questions are not available')
  }
  if (existing) throw new Error('You have already answered these questions')

  const now = new Date()
  if (!isWithinEvidenceWindow('RECALL', now, session)) {
    throw new Error('The answer window for this session has closed')
  }

  const attendance = await attendanceDb.findAttendanceForUserAsSystem(
    verified.sessionId,
    verified.userId
  )
  const attended = attendance?.status === 'PRESENT' || attendance?.status === 'LATE'
  const kind: 'RETENTION' | 'CATCH_UP' = attended ? 'RETENTION' : 'CATCH_UP'

  const { score, total, passed } = scoreAnswers(set.questions, answers)

  await recallDb.insertAnswer({
    orgId: session.org_id,
    sessionId: session.id,
    userId: verified.userId,
    kind,
    answers,
    score,
    total,
    passed,
  })

  // The supervisor rule: a passing catch-up is accepted attendance evidence.
  // RECALL is the lowest-priority source and stays visible as the primary
  // source, so caught-up attendance is always distinguishable in audits.
  let caughtUp = false
  const attendanceLocked = !!session.attendance_locked
  if (kind === 'CATCH_UP' && passed && !attendanceLocked) {
    await attendanceDb.insertAttendanceEvidenceAsSystem({
      orgId: session.org_id,
      sessionId: session.id,
      departmentId: session.department_id,
      userId: verified.userId,
      source: 'RECALL',
      observedAt: now.toISOString(),
      metadata: { status_override: 'PRESENT', method: 'RECALL_CATCH_UP', score },
    })

    const allEvidence = await attendanceDb.listSessionEvidenceAsSystem(session.id)
    const mine = allEvidence.filter((e) => e.user_id === verified.userId)
    const computed = computeAttendanceFromEvidence(mine, session)
    await attendanceDb.upsertAttendance({
      orgId: session.org_id,
      sessionId: session.id,
      departmentId: session.department_id,
      userId: verified.userId,
      externalEmail: null,
      status: computed.status,
      primarySource: computed.primarySource,
      firstEvidenceAt: computed.firstEvidenceAt,
    })
    caughtUp = true
  }

  return {
    score,
    total,
    passed,
    kind,
    caughtUp,
    attendanceLocked: kind === 'CATCH_UP' && passed && attendanceLocked,
    review: set.questions.map((q, i) => ({
      question: q.question,
      correct: q.options[q.answer_index],
      explanation: q.explanation,
      wasCorrect: answers[i] === q.answer_index,
    })),
  }
}
