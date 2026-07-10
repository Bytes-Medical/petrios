import { createHmac } from 'node:crypto'
import * as apiPlatformDb from '@/lib/db/api-platform'

/**
 * Outbound webhooks: org-admin-registered endpoints receive signed POSTs
 * when platform events fire. Fire-and-forget by contract — a webhook must
 * NEVER fail or slow the action that triggered it, so emitWebhook swallows
 * everything and delivery results land in webhook_deliveries for the
 * Settings panel. One attempt per event in v1 (retries: see ROADMAP.md).
 */

export const WEBHOOK_EVENTS = [
  'session.published',
  'attendance.computed',
  'certificate.issued',
  'slot.claimed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/**
 * SSRF guard for admin-supplied URLs (production only, so local dev can use
 * localhost listeners). Best-effort hostname checks — see docs/api.md for
 * the documented limits.
 */
export function isBlockedWebhookUrl(url: string, isProduction: boolean): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return true
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true
  if (!isProduction) return false

  const host = parsed.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return true
  }
  return false
}

export async function emitWebhook(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const endpoints = await apiPlatformDb.listActiveEndpointsForEvent(orgId, event)
    if (endpoints.length === 0) return

    const body = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload })
    const isProduction = process.env.NODE_ENV === 'production'

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        if (isBlockedWebhookUrl(endpoint.url, isProduction)) {
          await apiPlatformDb.insertWebhookDelivery({
            endpointId: endpoint.id,
            event,
            payload,
            status: 'failed',
            responseCode: null,
          })
          return
        }
        let responseCode: number | null = null
        let ok = false
        try {
          const response = await fetch(endpoint.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Bytes-Event': event,
              'X-Bytes-Signature': signWebhookBody(endpoint.secret, body),
            },
            body,
            signal: AbortSignal.timeout(5000),
          })
          responseCode = response.status
          ok = response.ok
        } catch {
          ok = false
        }
        await apiPlatformDb.insertWebhookDelivery({
          endpointId: endpoint.id,
          event,
          payload,
          status: ok ? 'ok' : 'failed',
          responseCode,
        })
      })
    )
  } catch (err) {
    console.error(`Webhook emit failed for ${event}:`, err)
  }
}
