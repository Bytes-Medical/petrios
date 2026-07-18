export type SessionDeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED'

/**
 * Normal background retries must never duplicate a successful delivery.
 * A moderator's explicit teacher-feedback resend is the one path allowed to
 * reacquire SENT rows; the same SENDING lease still blocks concurrent clicks.
 */
export function claimableSessionDeliveryStatuses(
  allowPreviouslySent: boolean
): SessionDeliveryStatus[] {
  return allowPreviouslySent
    ? ['PENDING', 'FAILED', 'SENT']
    : ['PENDING', 'FAILED']
}
