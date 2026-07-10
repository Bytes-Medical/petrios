'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { isOrgAdmin, requireAuth, requireOrg } from '@/lib/auth'
import { API_SCOPES, generateApiToken, type ApiScope } from '@/lib/api/auth'
import { WEBHOOK_EVENTS, isBlockedWebhookUrl, type WebhookEvent } from '@/lib/webhooks'
import * as apiPlatformDb from '@/lib/db/api-platform'
import type { ApiToken, WebhookDelivery, WebhookEndpoint } from '@/lib/db/api-platform'

/** Org-admin-only management of API tokens and webhooks (Settings page). */
async function requireOrgAdminContext(): Promise<{ userId: string; orgId: string }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  if (!(await isOrgAdmin(orgId))) {
    throw new Error('Org admin required')
  }
  return { userId, orgId }
}

export interface SafeApiToken {
  id: string
  name: string
  token_prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

function toSafeToken(token: ApiToken): SafeApiToken {
  return {
    id: token.id,
    name: token.name,
    token_prefix: token.token_prefix,
    scopes: token.scopes,
    last_used_at: token.last_used_at,
    revoked_at: token.revoked_at,
    created_at: token.created_at,
  }
}

export async function createApiToken(
  name: string,
  scopes: string[]
): Promise<{ token: string; record: SafeApiToken }> {
  const { userId, orgId } = await requireOrgAdminContext()

  const trimmed = name.trim()
  if (!trimmed) throw new Error('Token name is required')
  const validScopes = scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s))
  if (validScopes.length === 0) throw new Error('Select at least one scope')

  const { token, hash, prefix } = generateApiToken()
  const record = await apiPlatformDb.insertApiToken({
    orgId,
    name: trimmed.slice(0, 100),
    tokenHash: hash,
    tokenPrefix: prefix,
    scopes: validScopes,
    createdBy: userId,
  })

  revalidatePath('/settings')
  // The plaintext token is returned exactly once and never stored.
  return { token, record: toSafeToken(record) }
}

export async function listOrgApiTokens(): Promise<SafeApiToken[]> {
  const { orgId } = await requireOrgAdminContext()
  return (await apiPlatformDb.listApiTokens(orgId)).map(toSafeToken)
}

export async function revokeOrgApiToken(id: string): Promise<{ success: true }> {
  const { orgId } = await requireOrgAdminContext()
  await apiPlatformDb.revokeApiToken(id, orgId)
  revalidatePath('/settings')
  return { success: true }
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookView extends Omit<WebhookEndpoint, 'secret'> {
  secret_hint: string
}

export async function createWebhookEndpoint(
  url: string,
  events: string[]
): Promise<{ secret: string; endpoint: WebhookView }> {
  const { userId, orgId } = await requireOrgAdminContext()

  if (isBlockedWebhookUrl(url, process.env.NODE_ENV === 'production')) {
    throw new Error('Webhook URL must be a public http(s) address')
  }
  const validEvents = events.filter((e): e is WebhookEvent =>
    (WEBHOOK_EVENTS as readonly string[]).includes(e)
  )
  if (validEvents.length === 0) throw new Error('Select at least one event')

  const secret = `whsec_${randomBytes(24).toString('hex')}`
  const endpoint = await apiPlatformDb.insertWebhookEndpoint({
    orgId,
    url,
    secret,
    events: validEvents,
    createdBy: userId,
  })

  revalidatePath('/settings')
  const { secret: _secret, ...rest } = endpoint
  return { secret, endpoint: { ...rest, secret_hint: `${secret.slice(0, 10)}…` } }
}

export async function listWebhooks(): Promise<{
  endpoints: WebhookView[]
  deliveries: WebhookDelivery[]
}> {
  const { orgId } = await requireOrgAdminContext()
  const endpoints = await apiPlatformDb.listWebhookEndpoints(orgId)
  const deliveries = await apiPlatformDb.listRecentDeliveries(endpoints.map((e) => e.id))
  return {
    endpoints: endpoints.map(({ secret, ...rest }) => ({
      ...rest,
      secret_hint: `${secret.slice(0, 10)}…`,
    })),
    deliveries,
  }
}

export async function deleteWebhook(id: string): Promise<{ success: true }> {
  const { orgId } = await requireOrgAdminContext()
  await apiPlatformDb.deleteWebhookEndpoint(id, orgId)
  revalidatePath('/settings')
  return { success: true }
}

export async function setWebhookActive(id: string, active: boolean): Promise<{ success: true }> {
  const { orgId } = await requireOrgAdminContext()
  await apiPlatformDb.setWebhookEndpointActive(id, orgId, active)
  revalidatePath('/settings')
  return { success: true }
}
