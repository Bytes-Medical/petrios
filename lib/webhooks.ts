import { createHmac } from 'node:crypto'
import * as apiPlatformDb from '@/lib/db/api-platform'
import {
  isBlockedIpAddress,
  isBlockedWebhookUrl,
  webhookPrivateTargetsAllowed,
} from './webhook-guard'

/**
 * Outbound webhooks: org-admin-registered endpoints receive signed POSTs
 * when platform events fire. Fire-and-forget by contract — a webhook must
 * NEVER fail or slow the action that triggered it, so emitWebhook swallows
 * everything and delivery results land in webhook_deliveries for the
 * Settings panel. One attempt per event in v1 (retries: see ROADMAP.md).
 */

import type { WebhookEvent } from './webhook-events'
export { WEBHOOK_EVENTS, type WebhookEvent } from './webhook-events'

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export {
  isBlockedIpAddress,
  isBlockedWebhookHostname,
  isBlockedWebhookUrl,
  webhookPrivateTargetsAllowed,
} from './webhook-guard'

const WEBHOOK_TIMEOUT_MS = 5000

export interface ResolvedAddress {
  address: string
  family: number
}

/** Resolves every A/AAAA address for a hostname (injectable for tests). */
export type ResolveAllAddresses = (hostname: string) => Promise<ResolvedAddress[]>

async function resolveWithSystemDns(hostname: string): Promise<ResolvedAddress[]> {
  const dns = await import('node:dns')
  return dns.promises.lookup(hostname, { all: true, verbatim: true })
}

function blockedDestinationError(hostname: string): Error {
  return Object.assign(new Error(`Webhook host ${hostname} resolves to a non-public address`), {
    code: 'EWEBHOOKBLOCKED',
  })
}

/**
 * Rejects when DNS returned nothing or ANY returned address is non-public, so
 * a name with one public and one private record cannot be steered to the
 * private one.
 */
export function assertPublicResolvedAddresses(
  hostname: string,
  addresses: readonly ResolvedAddress[]
): void {
  if (addresses.length === 0 || addresses.some((entry) => isBlockedIpAddress(entry.address))) {
    throw blockedDestinationError(hostname)
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address?: string | ResolvedAddress[],
  family?: number
) => void

/**
 * A `lookup` for node:http(s) that resolves, checks every address, and hands
 * the socket only the checked addresses. The connection therefore goes to an
 * address that passed the guard (no DNS-rebinding gap between check and
 * connect).
 */
export function createGuardedLookup(resolveAll: ResolveAllAddresses = resolveWithSystemDns) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number | string } | number | undefined,
    callback: LookupCallback
  ): void => {
    const opts = typeof options === 'object' && options ? options : {}
    const family = typeof options === 'number' ? options : Number(opts.family) || 0
    resolveAll(hostname).then(
      (addresses) => {
        try {
          assertPublicResolvedAddresses(hostname, addresses)
        } catch (error) {
          callback(error as NodeJS.ErrnoException)
          return
        }
        const usable = family === 4 || family === 6
          ? addresses.filter((entry) => entry.family === family)
          : addresses
        if (usable.length === 0) {
          callback(Object.assign(new Error(`No address for ${hostname}`), { code: 'ENOTFOUND' }))
          return
        }
        if (opts.all) callback(null, usable)
        else callback(null, usable[0].address, usable[0].family)
      },
      (error) => callback(error as NodeJS.ErrnoException)
    )
  }
}

export interface WebhookPostResult {
  ok: boolean
  /** HTTP status, or null when no response arrived (blocked, DNS, timeout). */
  status: number | null
}

export interface WebhookTransportOptions {
  allowPrivate?: boolean
  /** Defaults to Workers when navigator.userAgent says so, else Node. */
  runtime?: 'node' | 'workers'
  resolveAll?: ResolveAllAddresses
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function detectRuntime(): 'node' | 'workers' {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
    ? 'workers'
    : 'node'
}

async function postWithNode(
  url: URL,
  headers: Record<string, string>,
  body: string,
  options: WebhookTransportOptions
): Promise<WebhookPostResult> {
  const transport =
    url.protocol === 'https:' ? await import('node:https') : await import('node:http')
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS

  return new Promise<WebhookPostResult>((resolve) => {
    let settled = false
    const finish = (result: WebhookPostResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    try {
      const request = transport.request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
          // Fresh connection per delivery so every connect runs the guarded lookup.
          agent: false,
          lookup: options.allowPrivate
            ? undefined
            : (createGuardedLookup(options.resolveAll) as never),
          signal: AbortSignal.timeout(timeoutMs),
        },
        (response) => {
          const status = response.statusCode ?? null
          // node:http never follows redirects: a 3xx is a failed delivery.
          finish({ ok: status !== null && status >= 200 && status < 300, status })
          response.destroy()
        }
      )
      request.on('error', () => finish({ ok: false, status: null }))
      request.end(body)
    } catch {
      finish({ ok: false, status: null })
    }
  })
}

async function postWithFetch(
  url: URL,
  headers: Record<string, string>,
  body: string,
  options: WebhookTransportOptions
): Promise<WebhookPostResult> {
  try {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: 'POST',
      headers,
      body,
      // Never follow: a public URL that 3xx-redirects inward must not be
      // chased; Workers return the 3xx itself, which counts as failed.
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? WEBHOOK_TIMEOUT_MS),
    })
    return { ok: response.ok && response.status >= 200 && response.status < 300, status: response.status }
  } catch {
    return { ok: false, status: null }
  }
}

/**
 * One guarded POST. The URL check runs first in every environment (unless
 * WEBHOOK_ALLOW_PRIVATE=true). On Node the request goes through node:http(s)
 * with the guarded DNS lookup and no redirect following; on a Workers
 * runtime fetch runs with redirect: 'manual'.
 */
export async function postWebhook(
  rawUrl: string,
  headers: Record<string, string>,
  body: string,
  options: WebhookTransportOptions = {}
): Promise<WebhookPostResult> {
  if (isBlockedWebhookUrl(rawUrl, { allowPrivate: options.allowPrivate })) {
    return { ok: false, status: null }
  }
  const url = new URL(rawUrl)
  const runtime = options.runtime ?? detectRuntime()
  return runtime === 'workers'
    ? postWithFetch(url, headers, body, options)
    : postWithNode(url, headers, body, options)
}

export async function emitWebhook(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  transport: Omit<WebhookTransportOptions, 'allowPrivate'> = {}
): Promise<void> {
  try {
    const endpoints = await apiPlatformDb.listActiveEndpointsForEvent(orgId, event)
    if (endpoints.length === 0) return

    const body = JSON.stringify({ event, created_at: new Date().toISOString(), data: payload })
    const allowPrivate = webhookPrivateTargetsAllowed()

    await Promise.allSettled(
      endpoints.map(async (endpoint) => {
        let result: WebhookPostResult = { ok: false, status: null }
        try {
          result = await postWebhook(
            endpoint.url,
            {
              'Content-Type': 'application/json',
              'X-Petrios-Event': event,
              'X-Petrios-Signature': signWebhookBody(endpoint.secret, body),
            },
            body,
            { ...transport, allowPrivate }
          )
        } catch {
          result = { ok: false, status: null }
        }
        await apiPlatformDb.insertWebhookDelivery({
          endpointId: endpoint.id,
          event,
          payload,
          status: result.ok ? 'ok' : 'failed',
          responseCode: result.status,
        })
      })
    )
  } catch (err) {
    console.error(`Webhook emit failed for ${event}:`, err)
  }
}
