import type {
  OpsActionStatus,
  OpsActionType,
  OpsAgentRun,
  OpsAgentRunStep,
  OpsChatMessage,
  OpsChatThread,
  OpsFeedbackSynthesis,
  OpsMemoryEntry,
  OpsNewsletterContent,
  OpsNewsletterDelivery,
  OpsNewsletterIssue,
  OpsNewsletterSourceDocument,
  OpsNewsletterStatus,
  OpsPendingAction,
  OpsSynthesisTheme,
} from '@/lib/types'
import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Petrios Ops DAL. Every ops_* table is deny-all RLS (migration 036), so all
 * access here is service-role by design. Authorization therefore lives with
 * the callers, never here:
 *   - server actions gate with requireOrgManager (organisers only)
 *   - cron routes are CRON_SECRET-authenticated
 * This module reads and writes ops_* tables ONLY — it must never touch core
 * app tables, so dropping the ops layer stays a pure DROP of ops_* objects.
 */

// ---------------------------------------------------------------------------
// Pending actions (the approval gate)
// ---------------------------------------------------------------------------

export async function insertPendingAction(input: {
  orgId: string
  departmentId?: string | null
  type: OpsActionType
  payload: Record<string, unknown>
  previewTitle: string
  previewBody: string
  createdBy?: string
}): Promise<OpsPendingAction> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_pending_actions')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId ?? null,
      type: input.type,
      payload: input.payload,
      preview_title: input.previewTitle,
      preview_body: input.previewBody,
      created_by: input.createdBy ?? 'system',
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create pending action', error)
  return data as OpsPendingAction
}

export async function listPendingActions(
  orgId: string,
  options: { statuses?: OpsActionStatus[]; limit?: number } = {}
): Promise<OpsPendingAction[]> {
  const db = await getServiceDb()
  let query = db
    .from('ops_pending_actions')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 50)

  if (options.statuses?.length) {
    query = query.in('status', options.statuses)
  }

  const { data, error } = await query
  if (error) throw toDbError('Failed to list pending actions', error)
  return (data as OpsPendingAction[] | null) ?? []
}

export async function findPendingAction(
  id: string,
  orgId: string
): Promise<OpsPendingAction | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_pending_actions')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw toDbError('Failed to fetch pending action', error)
  return (data as OpsPendingAction | null) ?? null
}

export async function countPendingActions(orgId: string): Promise<number> {
  const db = await getServiceDb()
  const { count, error } = await db
    .from('ops_pending_actions')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending')

  if (error) throw toDbError('Failed to count pending actions', error)
  return count ?? 0
}

/**
 * Atomically move a pending action to `approved` (compare-and-set on
 * status='pending'). Returns null if it was already reviewed — the caller
 * must not execute in that case, which is what makes double-clicking the
 * Approve button safe.
 */
export async function approvePendingAction(
  id: string,
  orgId: string,
  reviewedBy: string
): Promise<OpsPendingAction | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_pending_actions')
    .update({
      status: 'approved',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .select('*')

  if (error) throw toDbError('Failed to approve action', error)
  return (data?.[0] as OpsPendingAction | undefined) ?? null
}

export async function rejectPendingAction(
  id: string,
  orgId: string,
  reviewedBy: string
): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_pending_actions')
    .update({
      status: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('status', 'pending')
    .select('id')

  if (error) throw toDbError('Failed to reject action', error)
  return (data?.length ?? 0) > 0
}

export async function markActionExecuted(id: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_pending_actions')
    .update({ status: 'executed', executed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw toDbError('Failed to mark action executed', error)
}

export async function markActionFailed(id: string, message: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_pending_actions')
    .update({ status: 'failed', error: message.slice(0, 1000) })
    .eq('id', id)

  if (error) throw toDbError('Failed to mark action failed', error)
}

// ---------------------------------------------------------------------------
// Agent runs + steps (the audit trail; steps are append-only)
// ---------------------------------------------------------------------------

export async function insertAgentRun(input: {
  orgId?: string | null
  kind: string
  trigger: string
}): Promise<string> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_agent_runs')
    .insert({ org_id: input.orgId ?? null, kind: input.kind, trigger: input.trigger })
    .select('id')
    .single()

  if (error) throw toDbError('Failed to create agent run', error)
  return (data as { id: string }).id
}

export async function finishAgentRun(
  runId: string,
  status: 'succeeded' | 'failed',
  summary?: string
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_agent_runs')
    .update({ status, summary: summary ?? null, finished_at: new Date().toISOString() })
    .eq('id', runId)

  if (error) throw toDbError('Failed to finish agent run', error)
}

export async function insertAgentRunStep(input: {
  runId: string
  seq: number
  name: string
  detail?: Record<string, unknown> | null
  purpose?: string | null
  model?: string | null
  promptHash?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('ops_agent_run_steps').insert({
    run_id: input.runId,
    seq: input.seq,
    name: input.name,
    detail: input.detail ?? null,
    purpose: input.purpose ?? null,
    model: input.model ?? null,
    prompt_hash: input.promptHash ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
  })

  if (error) throw toDbError('Failed to record run step', error)
}

export async function findAgentRun(runId: string): Promise<OpsAgentRun | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_agent_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch agent run', error)
  return (data as OpsAgentRun | null) ?? null
}

/** Recent runs for the /ops audit view: the org's own plus platform-wide. */
export async function listRecentRuns(orgId: string, limit = 20): Promise<OpsAgentRun[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_agent_runs')
    .select('*')
    .or(`org_id.eq.${orgId},org_id.is.null`)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list agent runs', error)
  return (data as OpsAgentRun[] | null) ?? []
}

export async function listRunSteps(runId: string): Promise<OpsAgentRunStep[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_agent_run_steps')
    .select('*')
    .eq('run_id', runId)
    .order('seq', { ascending: true })

  if (error) throw toDbError('Failed to list run steps', error)
  return (data as OpsAgentRunStep[] | null) ?? []
}

// ---------------------------------------------------------------------------
// Feedback syntheses
// ---------------------------------------------------------------------------

export async function findSynthesisForSession(
  sessionId: string
): Promise<OpsFeedbackSynthesis | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_feedback_syntheses')
    .select('*')
    .eq('session_id', sessionId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch synthesis', error)
  return (data as OpsFeedbackSynthesis | null) ?? null
}

export async function listSynthesizedSessionIds(sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set()
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_feedback_syntheses')
    .select('session_id')
    .in('session_id', sessionIds)

  if (error) throw toDbError('Failed to list synthesized sessions', error)
  return new Set(((data as { session_id: string }[] | null) ?? []).map((r) => r.session_id))
}

export async function listSynthesesForSessions(
  sessionIds: string[]
): Promise<OpsFeedbackSynthesis[]> {
  if (sessionIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_feedback_syntheses')
    .select('*')
    .in('session_id', sessionIds)

  if (error) throw toDbError('Failed to list syntheses', error)
  return (data as OpsFeedbackSynthesis[] | null) ?? []
}

export async function insertSynthesis(input: {
  orgId: string
  departmentId: string
  sessionId: string
  themes: OpsSynthesisTheme[]
  sentiment: 'positive' | 'mixed' | 'negative'
  suggestions: string[]
  quotes: string[]
  requiresHumanReview: boolean
  responseCount: number
  averageRating: number | null
  model: string | null
}): Promise<OpsFeedbackSynthesis> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_feedback_syntheses')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      themes: input.themes,
      sentiment: input.sentiment,
      suggestions: input.suggestions,
      quotes: input.quotes,
      requires_human_review: input.requiresHumanReview,
      response_count: input.responseCount,
      average_rating: input.averageRating,
      model: input.model,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to store synthesis', error)
  return data as OpsFeedbackSynthesis
}

// ---------------------------------------------------------------------------
// Speaker chases
// ---------------------------------------------------------------------------

/** email(lowercased) -> chase_count for one session. */
export async function getChaseCounts(sessionId: string): Promise<Map<string, number>> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_speaker_chases')
    .select('target_email, chase_count')
    .eq('session_id', sessionId)

  if (error) throw toDbError('Failed to fetch chase counts', error)
  const map = new Map<string, number>()
  for (const row of (data as { target_email: string; chase_count: number }[] | null) ?? []) {
    map.set(row.target_email.toLowerCase(), row.chase_count)
  }
  return map
}

/**
 * Record that a chase email was actually sent (called by the executor, after
 * approval): increments chase_count, creating the row on first send. Cron is
 * the only writer so read-then-write is race-free in practice.
 */
export async function recordChaseSent(input: {
  orgId: string
  sessionId: string
  targetUserId?: string | null
  targetInvitationId?: string | null
  targetEmail: string
}): Promise<void> {
  const db = await getServiceDb()
  const email = input.targetEmail.toLowerCase()

  const { data: existing, error: findError } = await db
    .from('ops_speaker_chases')
    .select('id, chase_count')
    .eq('session_id', input.sessionId)
    .eq('target_email', email)
    .maybeSingle()

  if (findError) throw toDbError('Failed to look up speaker chase', findError)

  if (existing) {
    const { error } = await db
      .from('ops_speaker_chases')
      .update({
        chase_count: (existing as { chase_count: number }).chase_count + 1,
        last_chased_at: new Date().toISOString(),
      })
      .eq('id', (existing as { id: string }).id)
    if (error) throw toDbError('Failed to update speaker chase', error)
    return
  }

  const { error } = await db.from('ops_speaker_chases').insert({
    org_id: input.orgId,
    session_id: input.sessionId,
    target_user_id: input.targetUserId ?? null,
    target_invitation_id: input.targetInvitationId ?? null,
    target_email: email,
    chase_count: 1,
    last_chased_at: new Date().toISOString(),
  })
  if (error) throw toDbError('Failed to record speaker chase', error)
}

// ---------------------------------------------------------------------------
// Agent memory
// ---------------------------------------------------------------------------

export async function listMemory(orgId: string, limit = 50): Promise<OpsMemoryEntry[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_memory')
    .select('*')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list ops memory', error)
  return (data as OpsMemoryEntry[] | null) ?? []
}

export async function upsertMemory(input: {
  orgId: string
  key: string
  value: string
  source?: string
  createdBy?: string | null
  departmentId?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('ops_memory').upsert(
    {
      org_id: input.orgId,
      department_id: input.departmentId ?? null,
      key: input.key,
      value: input.value,
      source: input.source ?? 'assistant',
      created_by: input.createdBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,key' }
  )

  if (error) throw toDbError('Failed to save ops memory', error)
}

// ---------------------------------------------------------------------------
// Newsletter issues + opt-outs
// ---------------------------------------------------------------------------

export async function findNewsletterIssue(
  orgId: string,
  departmentId: string,
  weekStart: string
): Promise<OpsNewsletterIssue | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .select('*')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)
    .eq('week_start', weekStart)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch newsletter issue', error)
  return (data as OpsNewsletterIssue | null) ?? null
}

export async function findNewsletterIssueById(id: string): Promise<OpsNewsletterIssue | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch newsletter issue', error)
  return (data as OpsNewsletterIssue | null) ?? null
}

export async function insertNewsletterIssue(input: {
  orgId: string
  departmentId: string
  weekStart: string
  generatedBy: string
  subject: string
  html: string
  summaryPoints: { title: string; detail: string }[]
  content: OpsNewsletterContent
  sourceSessionIds: string[]
  sourceDocuments: OpsNewsletterSourceDocument[]
}): Promise<OpsNewsletterIssue> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      week_start: input.weekStart,
      generated_by: input.generatedBy,
      subject: input.subject,
      html: input.html,
      summary_points: input.summaryPoints,
      content: input.content,
      source_session_ids: input.sourceSessionIds,
      source_documents: input.sourceDocuments,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create newsletter issue', error)
  return data as OpsNewsletterIssue
}

export async function updateNewsletterIssue(
  id: string,
  patch: {
    status?: OpsNewsletterStatus
    pendingActionId?: string | null
    sentCount?: number
  }
): Promise<void> {
  const db = await getServiceDb()
  const update: Record<string, unknown> = {}
  if (patch.status) update.status = patch.status
  if (patch.pendingActionId !== undefined) update.pending_action_id = patch.pendingActionId
  if (patch.sentCount !== undefined) update.sent_count = patch.sentCount
  update.updated_at = new Date().toISOString()

  const { error } = await db.from('ops_newsletter_issues').update(update).eq('id', id)
  if (error) throw toDbError('Failed to update newsletter issue', error)
}

export async function replaceNewsletterDraft(input: {
  id: string
  orgId: string
  departmentId: string
  generatedBy: string
  subject: string
  html: string
  summaryPoints: { title: string; detail: string }[]
  content: OpsNewsletterContent
  sourceSessionIds: string[]
  sourceDocuments: OpsNewsletterSourceDocument[]
}): Promise<OpsNewsletterIssue> {
  const db = await getServiceDb()
  const update: Record<string, unknown> = {
    generated_by: input.generatedBy,
    subject: input.subject,
    html: input.html,
    summary_points: input.summaryPoints,
    content: input.content,
    status: 'draft',
    pending_action_id: null,
    source_session_ids: input.sourceSessionIds,
    source_documents: input.sourceDocuments,
    content_revision: 1,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .update(update)
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .in('status', ['draft', 'failed'])
    .eq('sent_count', 0)
    .select('*')
    .maybeSingle()
  if (error) throw toDbError('Failed to replace newsletter draft', error)
  if (!data) throw new Error('This newsletter is no longer editable')
  return data as OpsNewsletterIssue
}

export async function saveNewsletterDraft(input: {
  id: string
  orgId: string
  departmentId: string
  subject: string
  html: string
  summaryPoints: { title: string; detail: string }[]
  content: OpsNewsletterContent
  expectedRevision: number
}): Promise<OpsNewsletterIssue> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .update({
      subject: input.subject,
      html: input.html,
      summary_points: input.summaryPoints,
      content: input.content,
      content_revision: input.expectedRevision + 1,
      status: 'draft',
      pending_action_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .in('status', ['draft', 'failed'])
    .eq('sent_count', 0)
    .eq('content_revision', input.expectedRevision)
    .select('*')
    .maybeSingle()
  if (error) throw toDbError('Failed to save newsletter draft', error)
  if (!data) throw new Error('The newsletter changed; refresh before saving again')
  return data as OpsNewsletterIssue
}

export async function listNewsletterIssues(
  orgId: string,
  departmentIds: string[],
  limit = 26
): Promise<OpsNewsletterIssue[]> {
  if (departmentIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_issues')
    .select('*')
    .eq('org_id', orgId)
    .in('department_id', departmentIds)
    .order('week_start', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list newsletter issues', error)
  return (data as OpsNewsletterIssue[] | null) ?? []
}

export async function insertNewsletterOptout(orgId: string, userId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_newsletter_optouts')
    .upsert({ org_id: orgId, user_id: userId }, { onConflict: 'org_id,user_id', ignoreDuplicates: true })

  if (error) throw toDbError('Failed to record newsletter opt-out', error)
}

export async function listNewsletterOptoutUserIds(orgId: string): Promise<Set<string>> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_optouts')
    .select('user_id')
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to list newsletter opt-outs', error)
  return new Set(((data as { user_id: string }[] | null) ?? []).map((r) => r.user_id))
}

export async function deleteUnsentNewsletterDeliveries(issueId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_newsletter_deliveries')
    .delete()
    .eq('issue_id', issueId)
    .neq('status', 'SENT')
  if (error) throw toDbError('Failed to clear obsolete newsletter deliveries', error)
}

export async function seedNewsletterDeliveries(input: {
  issue: OpsNewsletterIssue
  recipients: { userId: string; email: string }[]
}): Promise<void> {
  if (input.recipients.length === 0) return
  const db = await getServiceDb()
  const { error } = await db.from('ops_newsletter_deliveries').upsert(
    input.recipients.map((recipient) => ({
      issue_id: input.issue.id,
      org_id: input.issue.org_id,
      department_id: input.issue.department_id,
      recipient_user_id: recipient.userId,
      recipient_email: recipient.email.trim().toLowerCase(),
      content_revision: input.issue.content_revision,
    })),
    { onConflict: 'issue_id,recipient_user_id', ignoreDuplicates: true }
  )
  if (error) throw toDbError('Failed to prepare newsletter deliveries', error)
}

export async function listNewsletterDeliveries(
  issueId: string
): Promise<OpsNewsletterDelivery[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_newsletter_deliveries')
    .select('*')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true })
  if (error) throw toDbError('Failed to list newsletter deliveries', error)
  return (data as OpsNewsletterDelivery[] | null) ?? []
}

export async function claimNewsletterDelivery(
  deliveryId: string
): Promise<OpsNewsletterDelivery | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('claim_ops_newsletter_delivery_v1', { p_delivery_id: deliveryId })
    .maybeSingle()
  if (error) throw toDbError('Failed to claim newsletter delivery', error)
  return (data as OpsNewsletterDelivery | null) ?? null
}

export async function finishNewsletterDelivery(input: {
  id: string
  success: boolean
  providerMessageId?: string | null
  error?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const now = new Date().toISOString()
  const { error } = await db
    .from('ops_newsletter_deliveries')
    .update(input.success
      ? {
          status: 'SENT',
          sent_at: now,
          provider_message_id: input.providerMessageId ?? null,
          last_error: null,
          updated_at: now,
        }
      : {
          status: 'FAILED',
          last_error: (input.error ?? 'Newsletter delivery failed').slice(0, 1000),
          updated_at: now,
        })
    .eq('id', input.id)
    .eq('status', 'SENDING')
  if (error) throw toDbError('Failed to finish newsletter delivery', error)
}

// ---------------------------------------------------------------------------
// Assistant chat threads + messages (scoped to the owning organiser)
// ---------------------------------------------------------------------------

export async function insertChatThread(input: {
  orgId: string
  userId: string
  title: string
}): Promise<OpsChatThread> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_chat_threads')
    .insert({ org_id: input.orgId, user_id: input.userId, title: input.title })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create chat thread', error)
  return data as OpsChatThread
}

export async function findChatThread(
  id: string,
  userId: string
): Promise<OpsChatThread | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_chat_threads')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch chat thread', error)
  return (data as OpsChatThread | null) ?? null
}

export async function listChatThreads(
  userId: string,
  orgId: string,
  limit = 20
): Promise<OpsChatThread[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_chat_threads')
    .select('*')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list chat threads', error)
  return (data as OpsChatThread[] | null) ?? []
}

export async function touchChatThread(id: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('ops_chat_threads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw toDbError('Failed to update chat thread', error)
}

export async function insertChatMessage(input: {
  threadId: string
  role: 'user' | 'assistant'
  content: string
  toolSummary?: { name: string; ok: boolean }[] | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('ops_chat_messages').insert({
    thread_id: input.threadId,
    role: input.role,
    content: input.content,
    tool_summary: input.toolSummary ?? null,
  })

  if (error) throw toDbError('Failed to store chat message', error)
}

export async function listChatMessages(threadId: string): Promise<OpsChatMessage[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('ops_chat_messages')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })

  if (error) throw toDbError('Failed to list chat messages', error)
  return (data as OpsChatMessage[] | null) ?? []
}
