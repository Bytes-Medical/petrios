import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Public-API platform DAL (api_tokens, webhook_endpoints/deliveries — all
 * deny-all RLS). Callers: org-admin-gated actions (app/actions/api-platform)
 * and the bearer-token auth layer (lib/api/auth.ts), which authenticates by
 * token hash before touching anything org-scoped.
 */

export interface ApiToken {
  id: string
  org_id: string
  name: string
  token_hash: string
  token_prefix: string
  scopes: string[]
  created_by: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface WebhookEndpoint {
  id: string
  org_id: string
  url: string
  secret: string
  events: string[]
  active: boolean
  created_by: string
  created_at: string
}

export interface WebhookDelivery {
  id: string
  endpoint_id: string
  event: string
  payload: Record<string, unknown>
  status: 'ok' | 'failed'
  response_code: number | null
  attempts: number
  created_at: string
}

export async function insertApiToken(input: {
  orgId: string
  name: string
  tokenHash: string
  tokenPrefix: string
  scopes: string[]
  createdBy: string
}): Promise<ApiToken> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('api_tokens')
    .insert({
      org_id: input.orgId,
      name: input.name,
      token_hash: input.tokenHash,
      token_prefix: input.tokenPrefix,
      scopes: input.scopes,
      created_by: input.createdBy,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create API token', error)
  return data as ApiToken
}

export async function findActiveTokenByHash(tokenHash: string): Promise<ApiToken | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('api_tokens')
    .select('*')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) throw toDbError('Failed to look up API token', error)
  return (data as ApiToken | null) ?? null
}

export async function touchTokenLastUsed(id: string): Promise<void> {
  const db = await getServiceDb()
  // Best-effort telemetry; never fail a request over it.
  await db.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', id)
}

export async function listApiTokens(orgId: string): Promise<ApiToken[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('api_tokens')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to list API tokens', error)
  return (data as ApiToken[] | null) ?? []
}

export async function revokeApiToken(id: string, orgId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('api_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to revoke API token', error)
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export async function insertWebhookEndpoint(input: {
  orgId: string
  url: string
  secret: string
  events: string[]
  createdBy: string
}): Promise<WebhookEndpoint> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('webhook_endpoints')
    .insert({
      org_id: input.orgId,
      url: input.url,
      secret: input.secret,
      events: input.events,
      created_by: input.createdBy,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create webhook endpoint', error)
  return data as WebhookEndpoint
}

export async function listWebhookEndpoints(orgId: string): Promise<WebhookEndpoint[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to list webhook endpoints', error)
  return (data as WebhookEndpoint[] | null) ?? []
}

export async function listActiveEndpointsForEvent(
  orgId: string,
  event: string
): Promise<WebhookEndpoint[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('webhook_endpoints')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .contains('events', [event])

  if (error) throw toDbError('Failed to list webhook endpoints', error)
  return (data as WebhookEndpoint[] | null) ?? []
}

export async function deleteWebhookEndpoint(id: string, orgId: string): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to delete webhook endpoint', error)
}

export async function setWebhookEndpointActive(
  id: string,
  orgId: string,
  active: boolean
): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('webhook_endpoints')
    .update({ active })
    .eq('id', id)
    .eq('org_id', orgId)

  if (error) throw toDbError('Failed to update webhook endpoint', error)
}

export async function insertWebhookDelivery(input: {
  endpointId: string
  event: string
  payload: Record<string, unknown>
  status: 'ok' | 'failed'
  responseCode: number | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('webhook_deliveries').insert({
    endpoint_id: input.endpointId,
    event: input.event,
    payload: input.payload,
    status: input.status,
    response_code: input.responseCode,
  })

  if (error) throw toDbError('Failed to record webhook delivery', error)
}

export async function listRecentDeliveries(
  endpointIds: string[],
  limit = 20
): Promise<WebhookDelivery[]> {
  if (endpointIds.length === 0) return []
  const db = await getServiceDb()
  const { data, error } = await db
    .from('webhook_deliveries')
    .select('*')
    .in('endpoint_id', endpointIds)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list webhook deliveries', error)
  return (data as WebhookDelivery[] | null) ?? []
}
