import type { RecallQuestion } from '@/lib/recall'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Byte Recall DAL. Both tables are deny-all RLS: question sets are managed
 * by moderators through requireDepartmentModerator-gated actions and the
 * CRON_SECRET-authenticated crons; answers arrive through HMAC capability
 * tokens on the public answer page (the token IS the authorization, same
 * model as slot claim links).
 */

export interface RecallQuestionSet {
  id: string
  org_id: string
  session_id: string
  questions: RecallQuestion[]
  status: 'draft' | 'approved'
  model: string | null
  approved_by: string | null
  approved_at: string | null
  sent_attendees_at: string | null
  sent_boost_at: string | null
  sent_catchup_at: string | null
  created_at: string
}

export interface RecallAnswer {
  id: string
  org_id: string
  session_id: string
  user_id: string
  kind: 'RETENTION' | 'CATCH_UP'
  answers: number[]
  score: number
  total: number
  passed: boolean
  answered_at: string
}

export async function findSetForSession(sessionId: string): Promise<RecallQuestionSet | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_question_sets')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch recall question set', error)
  return (data as RecallQuestionSet | null) ?? null
}

export async function listSessionIdsWithSets(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set()
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_question_sets')
    .select('session_id')
    .in('session_id', sessionIds)

  if (error) throw toDbError('Failed to list recall sets', error)
  return new Set(((data as { session_id: string }[] | null) ?? []).map((r) => r.session_id))
}

export async function insertDraftSet(input: {
  orgId: string
  sessionId: string
  questions: RecallQuestion[]
  model: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('recall_question_sets').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    questions: input.questions,
    model: input.model,
  })

  if (error) throw toDbError('Failed to store recall question set', error)
}

export async function updateSetQuestions(input: {
  setId: string
  questions: RecallQuestion[]
  approve: boolean
  userId: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('recall_question_sets')
    .update({
      questions: input.questions,
      ...(input.approve
        ? {
            status: 'approved',
            approved_by: input.userId,
            approved_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', input.setId)

  if (error) throw toDbError('Failed to update recall question set', error)
}

/** Approved sets that still owe a send for the given watermark column. */
export async function listApprovedSetsNeedingSend(
  watermark: 'sent_attendees_at' | 'sent_boost_at' | 'sent_catchup_at',
  limit = 20
): Promise<RecallQuestionSet[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_question_sets')
    .select('*')
    .eq('status', 'approved')
    .is(watermark, null)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw toDbError('Failed to list sets needing send', error)
  return (data as RecallQuestionSet[] | null) ?? []
}

export async function markSetSent(
  setId: string,
  watermark: 'sent_attendees_at' | 'sent_boost_at' | 'sent_catchup_at'
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('recall_question_sets')
    .update({ [watermark]: new Date().toISOString() })
    .eq('id', setId)

  if (error) throw toDbError('Failed to mark recall set sent', error)
}

export async function findAnswer(
  sessionId: string,
  userId: string
): Promise<RecallAnswer | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_answers')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch recall answer', error)
  return (data as RecallAnswer | null) ?? null
}

export async function insertAnswer(input: {
  orgId: string
  sessionId: string
  userId: string
  kind: 'RETENTION' | 'CATCH_UP'
  answers: number[]
  score: number
  total: number
  passed: boolean
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('recall_answers').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    user_id: input.userId,
    kind: input.kind,
    answers: input.answers,
    score: input.score,
    total: input.total,
    passed: input.passed,
  })

  if (error) throw toDbError('Failed to store recall answer', error)
}

export async function listAnsweredUserIds(sessionId: string): Promise<Set<string>> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_answers')
    .select('user_id')
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to list recall answers', error)
  return new Set(((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id))
}
