import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * "You said, we did" DAL (feedback_actions, deny-all RLS).
 *
 * Service role justification: writes are gated by requireDepartmentModerator
 * in app/actions/feedback-actions.ts; reads are intentionally public —
 * moderator-authored plain text rendered on the public feedback pages for
 * published sessions (closing the feedback loop is the point). No attendee
 * identity is stored beyond created_by, which is never rendered publicly.
 */

export interface FeedbackAction {
  id: string
  org_id: string
  department_id: string
  session_id: string
  theme: string
  action: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export async function listActionsForSession(sessionId: string): Promise<FeedbackAction[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('feedback_actions')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to list feedback actions', error)
  return (data as FeedbackAction[] | null) ?? []
}

export async function listRecentActionsForDepartment(
  departmentId: string,
  limit = 5
): Promise<FeedbackAction[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('feedback_actions')
    .select('*')
    .eq('department_id', departmentId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list department feedback actions', error)
  return (data as FeedbackAction[] | null) ?? []
}

export async function findAction(id: string, orgId: string): Promise<FeedbackAction | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('feedback_actions')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch feedback action', error)
  return (data as FeedbackAction | null) ?? null
}

export async function insertAction(input: {
  orgId: string
  departmentId: string
  sessionId: string
  theme: string
  action: string
  createdBy: string
}): Promise<FeedbackAction> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('feedback_actions')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      theme: input.theme,
      action: input.action,
      created_by: input.createdBy,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create feedback action', error)
  return data as FeedbackAction
}

export async function updateAction(input: {
  id: string
  orgId: string
  theme: string
  action: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('feedback_actions')
    .update({
      theme: input.theme,
      action: input.action,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.id)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to update feedback action', error)
}

export async function deleteAction(input: { id: string; orgId: string }): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('feedback_actions')
    .delete()
    .eq('id', input.id)
    .eq('org_id', input.orgId)

  if (error) throw toDbError('Failed to delete feedback action', error)
}
