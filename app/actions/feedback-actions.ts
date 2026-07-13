'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import * as feedbackActionsDb from '@/lib/db/feedback-actions'
import * as sessionsDb from '@/lib/db/sessions'
import type { FeedbackAction } from '@/lib/db/feedback-actions'

/**
 * "You said, we did" actions. Moderators record what changed in response to
 * session feedback; the entries render publicly on the feedback pages
 * (closing the loop). All mutations are requireDepartmentModerator-gated.
 */

// Not exported: 'use server' files may only export async functions. The
// FeedbackActionsPanel mirrors this cap in its maxLength attributes.
const MAX_FEEDBACK_ACTION_FIELD_LENGTH = 280

function validateFields(theme: string, action: string): { theme: string; action: string } {
  const trimmedTheme = theme.trim()
  const trimmedAction = action.trim()
  if (!trimmedTheme || !trimmedAction) {
    throw new Error('Both fields are required')
  }
  if (
    trimmedTheme.length > MAX_FEEDBACK_ACTION_FIELD_LENGTH ||
    trimmedAction.length > MAX_FEEDBACK_ACTION_FIELD_LENGTH
  ) {
    throw new Error(`Each field must be ${MAX_FEEDBACK_ACTION_FIELD_LENGTH} characters or fewer`)
  }
  return { theme: trimmedTheme, action: trimmedAction }
}

function revalidateFeedbackSurfaces(sessionId: string, departmentId: string) {
  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}/feedback`)
  revalidatePath(`/departments/${departmentId}/feedback`)
}

export async function createFeedbackAction(
  sessionId: string,
  input: { theme: string; action: string }
): Promise<FeedbackAction> {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const session = await sessionsDb.findSession(sessionId, orgId)
  if (!session) throw new Error('Session not found')
  await requireDepartmentModerator(session.department_id)

  const fields = validateFields(input.theme, input.action)
  const created = await feedbackActionsDb.insertAction({
    orgId,
    departmentId: session.department_id,
    sessionId,
    theme: fields.theme,
    action: fields.action,
    createdBy: userId,
  })

  revalidateFeedbackSurfaces(sessionId, session.department_id)
  return created
}

export async function updateFeedbackAction(
  actionId: string,
  input: { theme: string; action: string }
): Promise<void> {
  await requireAuth()
  const orgId = await requireOrg()
  const existing = await feedbackActionsDb.findAction(actionId, orgId)
  if (!existing) throw new Error('Entry not found')
  await requireDepartmentModerator(existing.department_id)

  const fields = validateFields(input.theme, input.action)
  await feedbackActionsDb.updateAction({
    id: actionId,
    orgId,
    theme: fields.theme,
    action: fields.action,
  })

  revalidateFeedbackSurfaces(existing.session_id, existing.department_id)
}

export async function deleteFeedbackAction(actionId: string): Promise<void> {
  await requireAuth()
  const orgId = await requireOrg()
  const existing = await feedbackActionsDb.findAction(actionId, orgId)
  if (!existing) throw new Error('Entry not found')
  await requireDepartmentModerator(existing.department_id)

  await feedbackActionsDb.deleteAction({ id: actionId, orgId })
  revalidateFeedbackSurfaces(existing.session_id, existing.department_id)
}
