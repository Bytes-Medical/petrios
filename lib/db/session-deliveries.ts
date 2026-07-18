import { getServiceDb } from './client'
import { toDbError } from './errors'
import {
  claimableSessionDeliveryStatuses,
  type SessionDeliveryStatus,
} from '@/lib/session-delivery-policy'

export interface SessionDelivery {
  id: string
  status: SessionDeliveryStatus
  attempt_count: number
}

/**
 * Acquire a delivery before contacting the provider. A 15-minute lease makes
 * crashed SENDING attempts recoverable while preventing concurrent sends.
 * SENT is claimable only for an explicit moderator resend; cron callers keep
 * the default effectively-once behavior.
 */
export async function claimSessionDelivery(
  id: string,
  options: { allowPreviouslySent?: boolean } = {}
): Promise<boolean> {
  const db = await getServiceDb()
  const now = new Date()
  const claim = {
    status: 'SENDING',
    last_attempt_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
  const { data: fresh, error: freshError } = await db
    .from('session_deliveries')
    .update(claim)
    .eq('id', id)
    .in(
      'status',
      claimableSessionDeliveryStatuses(options.allowPreviouslySent === true)
    )
    .select('id')
    .maybeSingle()
  if (freshError) throw toDbError('Failed to claim delivery', freshError)
  if (fresh) return true

  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString()
  const { data: stale, error: staleError } = await db
    .from('session_deliveries')
    .update(claim)
    .eq('id', id)
    .eq('status', 'SENDING')
    .lt('last_attempt_at', staleBefore)
    .select('id')
    .maybeSingle()
  if (staleError) throw toDbError('Failed to reclaim stale delivery', staleError)
  return Boolean(stale)
}

/** Service-only delivery ledger used by cron and moderator-approved sends. */
export async function getOrCreateSessionDelivery(input: {
  orgId: string
  departmentId: string
  sessionId: string
  recipientUserId?: string | null
  recipientEmail: string
  deliveryType: string
  relatedId: string
}): Promise<SessionDelivery> {
  const db = await getServiceDb()
  const normalizedEmail = input.recipientEmail.trim().toLowerCase()
  const { data: existing, error: readError } = await db
    .from('session_deliveries')
    .select('id, status, attempt_count')
    .eq('session_id', input.sessionId)
    .eq('recipient_email', normalizedEmail)
    .eq('delivery_type', input.deliveryType)
    .eq('related_id', input.relatedId)
    .maybeSingle()
  if (readError) throw toDbError('Failed to read delivery state', readError)
  if (existing) return existing as SessionDelivery

  const { data, error } = await db
    .from('session_deliveries')
    .insert({
      org_id: input.orgId,
      department_id: input.departmentId,
      session_id: input.sessionId,
      recipient_user_id: input.recipientUserId ?? null,
      recipient_email: normalizedEmail,
      delivery_type: input.deliveryType,
      related_id: input.relatedId,
    })
    .select('id, status, attempt_count')
    .single()
  if (error) {
    // A concurrent creator may have won the unique constraint.
    const { data: raced, error: racedError } = await db
      .from('session_deliveries')
      .select('id, status, attempt_count')
      .eq('session_id', input.sessionId)
      .eq('recipient_email', normalizedEmail)
      .eq('delivery_type', input.deliveryType)
      .eq('related_id', input.relatedId)
      .single()
    if (racedError) throw toDbError('Failed to create delivery state', error)
    return raced as SessionDelivery
  }
  return data as SessionDelivery
}

export async function recordDeliveryAttempt(input: {
  id: string
  success: boolean
  providerMessageId?: string | null
  error?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { data: current, error: readError } = await db
    .from('session_deliveries')
    .select('attempt_count, provider_message_id, sent_at')
    .eq('id', input.id)
    .single()
  if (readError) throw toDbError('Failed to read delivery attempt count', readError)

  const now = new Date().toISOString()
  const { error } = await db
    .from('session_deliveries')
    .update({
      status: input.success ? 'SENT' : 'FAILED',
      attempt_count: Number(current.attempt_count) + 1,
      provider_message_id: input.success
        ? (input.providerMessageId ?? null)
        : current.provider_message_id,
      last_error: input.success ? null : (input.error ?? 'Unknown delivery error'),
      last_attempt_at: now,
      sent_at: input.success ? now : current.sent_at,
      updated_at: now,
    })
    .eq('id', input.id)
  if (error) throw toDbError('Failed to record delivery attempt', error)
}
