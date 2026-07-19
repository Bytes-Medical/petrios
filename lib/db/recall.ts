import type { RecallQuestion } from '@/lib/recall'
import type { RecallAnswerStat } from '@/lib/recall-analytics'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Petrios Recall DAL. Both tables are deny-all RLS: question sets are managed
 * by moderators through requireDepartmentModerator-gated actions and the
 * CRON_SECRET-authenticated crons; learner writes arrive only after an HMAC
 * deep link is matched to the exact authenticated user in server actions.
 */

export interface RecallQuestionSet {
  id: string
  org_id: string
  session_id: string
  questions: RecallQuestion[]
  script_digest: string | null
  revision: number
  status: 'draft' | 'approved' | 'retired'
  model: string | null
  approved_by: string | null
  approved_at: string | null
  published_at: string | null
  catchup_opens_at: string | null
  catchup_closes_at: string | null
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
    .in('status', ['draft', 'approved'])
    .order('revision', { ascending: false })
    .limit(1)
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

export async function upsertDraftSet(input: {
  orgId: string
  sessionId: string
  questions: RecallQuestion[]
  model: string | null
  scriptDigest: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.rpc('replace_recall_question_set_draft_v1', {
    p_org_id: input.orgId,
    p_session_id: input.sessionId,
    p_questions: input.questions,
    p_model: input.model,
    p_script_digest: input.scriptDigest,
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
  if (input.approve) {
    const { error } = await db.rpc('publish_recall_question_set_v1', {
      p_set_id: input.setId,
      p_questions: input.questions,
      p_user_id: input.userId,
    })
    if (error) throw toDbError('Failed to publish recall question set', error)
    return
  }

  const { data, error } = await db
    .from('recall_question_sets')
    .update({ questions: input.questions })
    .eq('id', input.setId)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle()

  if (error) throw toDbError('Failed to update recall question set', error)
  if (!data) throw new Error('The Recall question set changed; refresh and try again')
}

export async function recallPublishedSet(setId: string): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('recall_published_question_set_v1', { p_set_id: setId })
    .maybeSingle()
  if (error) throw toDbError('Failed to recall question set', error)
  return Boolean(data)
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

/**
 * Aggregate-only feed for retention analytics: deliberately excludes user_id
 * so no caller can correlate an individual's score. The moderator-gated
 * action computes aggregates (with small-cohort suppression) from these rows
 * and only the aggregates cross the server boundary.
 */
export async function listAnswerStatsForSession(
  sessionId: string
): Promise<RecallAnswerStat[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_answers')
    .select('kind, score, total, passed, answered_at')
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to list recall answer stats', error)
  return (data as RecallAnswerStat[] | null) ?? []
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

export interface RecallPlaybackProgress {
  id: string
  listened_seconds: number
  completed_at: string | null
  audio_revision: number
}

export async function recordPlaybackProgress(input: {
  questionSetId: string
  userId: string
  positionSeconds: number
  isPlaying: boolean
  finished: boolean
}): Promise<RecallPlaybackProgress> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('record_recall_playback_v1', {
      p_question_set_id: input.questionSetId,
      p_user_id: input.userId,
      p_position_seconds: input.positionSeconds,
      p_is_playing: input.isPlaying,
      p_finished: input.finished,
    })
    .single()
  if (error) throw toDbError('Failed to record recap playback', error)
  return data as RecallPlaybackProgress
}

export async function findPlaybackProgress(
  questionSetId: string,
  userId: string
): Promise<RecallPlaybackProgress | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_playback_progress')
    .select('id, listened_seconds, completed_at, audio_revision')
    .eq('question_set_id', questionSetId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw toDbError('Failed to read recap playback', error)
  return (data as RecallPlaybackProgress | null) ?? null
}

export interface RecallAttempt {
  id: string
  attempt_number: number
  score: number
  total: number
  passed: boolean
}

export async function listAttempts(
  questionSetId: string,
  userId: string
): Promise<RecallAttempt[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_attempts')
    .select('id, attempt_number, score, total, passed')
    .eq('question_set_id', questionSetId)
    .eq('user_id', userId)
    .order('attempt_number', { ascending: true })
  if (error) throw toDbError('Failed to list recall attempts', error)
  return (data as RecallAttempt[] | null) ?? []
}

export async function insertAttempt(input: {
  orgId: string
  sessionId: string
  questionSetId: string
  playbackId: string
  userId: string
  attemptNumber: number
  answers: number[]
  score: number
  passed: boolean
}): Promise<RecallAttempt> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_attempts')
    .insert({
      org_id: input.orgId,
      session_id: input.sessionId,
      question_set_id: input.questionSetId,
      playback_id: input.playbackId,
      user_id: input.userId,
      attempt_number: input.attemptNumber,
      answers: input.answers,
      score: input.score,
      total: 5,
      passed: input.passed,
    })
    .select('id, attempt_number, score, total, passed')
    .single()
  if (error) throw toDbError('Failed to store recall attempt', error)
  return data as RecallAttempt
}

export interface RecallCompletion {
  id: string
  org_id: string
  department_id: string
  session_id: string
  user_id: string
  attendance_revision: number
  certificate_id: string | null
  award_status: 'PENDING' | 'ISSUED' | 'DELIVERED' | 'FAILED'
}

export async function completeCatchup(input: {
  questionSetId: string
  userId: string
  perfectAttemptId: string
}): Promise<RecallCompletion> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('complete_recall_catchup_v2', {
      p_question_set_id: input.questionSetId,
      p_user_id: input.userId,
      p_perfect_attempt_id: input.perfectAttemptId,
    })
    .single()
  if (error) throw toDbError('Failed to recognize catch-up attendance', error)
  return data as RecallCompletion
}

export async function findCompletion(
  sessionId: string,
  userId: string
): Promise<RecallCompletion | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_completions')
    .select('id, org_id, department_id, session_id, user_id, attendance_revision, certificate_id, award_status')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw toDbError('Failed to read catch-up completion', error)
  return (data as RecallCompletion | null) ?? null
}

export async function updateCompletionAward(input: {
  completionId: string
  status: RecallCompletion['award_status']
  certificateId?: string | null
  error?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const values: Record<string, unknown> = {
    award_status: input.status,
    last_error: input.error ?? null,
    updated_at: new Date().toISOString(),
  }
  if (input.certificateId !== undefined) values.certificate_id = input.certificateId
  const { error } = await db
    .from('recall_completions')
    .update(values)
    .eq('id', input.completionId)
  if (error) throw toDbError('Failed to update catch-up award', error)
}

export async function listCompletionsNeedingAward(limit = 50): Promise<RecallCompletion[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('recall_completions')
    .select('id, org_id, department_id, session_id, user_id, attendance_revision, certificate_id, award_status')
    .in('award_status', ['PENDING', 'ISSUED', 'FAILED'])
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw toDbError('Failed to list pending catch-up awards', error)
  return (data as RecallCompletion[] | null) ?? []
}
