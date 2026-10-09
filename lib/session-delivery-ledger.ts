import type { SessionDeliveryStatus } from '@/lib/session-delivery-policy'

/** The ledger's natural key stores recipient email in this form. */
export function normalizeDeliveryEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** `session_deliveries.delivery_type` for the ~24h session reminder; related_id is the session id. */
export const SESSION_REMINDER_DELIVERY_TYPE = 'SESSION_REMINDER'

/** Provider failures after which a reminder recipient stops blocking the session watermark. */
export const SESSION_REMINDER_MAX_ATTEMPTS = 3

export type ReminderDeliveryDecision = 'SENT' | 'GAVE_UP' | 'SEND'

interface DeliveryState {
  status: SessionDeliveryStatus
  attempt_count: number
}

/**
 * SENT never repeats. FAILED retries on later runs until the attempt cap and
 * then counts as finished. A missing, PENDING or SENDING row goes to the
 * claim, which decides between a live lease and a stale one.
 */
export function reminderDeliveryDecision(
  delivery: DeliveryState | undefined,
  maxAttempts: number = SESSION_REMINDER_MAX_ATTEMPTS
): ReminderDeliveryDecision {
  if (!delivery) return 'SEND'
  if (delivery.status === 'SENT') return 'SENT'
  if (delivery.status === 'FAILED' && delivery.attempt_count >= maxAttempts) return 'GAVE_UP'
  return 'SEND'
}

/**
 * Recipients that still need a reminder attempt, in input order. Ledger rows
 * are matched on the normalized email, which is the table's natural key.
 */
export function pendingReminderRecipients<T extends { email: string }>(
  recipients: readonly T[],
  ledger: readonly (DeliveryState & { recipient_email: string })[],
  maxAttempts: number = SESSION_REMINDER_MAX_ATTEMPTS
): T[] {
  const byEmail = new Map(
    ledger.map((row) => [normalizeDeliveryEmail(row.recipient_email), row])
  )
  return recipients.filter(
    (recipient) =>
      reminderDeliveryDecision(byEmail.get(normalizeDeliveryEmail(recipient.email)), maxAttempts) ===
      'SEND'
  )
}
