/**
 * Webhook event names — client-safe constants (imported by the Settings UI
 * as well as the server-only emitter in lib/webhooks.ts).
 */
export const WEBHOOK_EVENTS = [
  'session.published',
  'attendance.computed',
  'certificate.issued',
  'slot.claimed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]
