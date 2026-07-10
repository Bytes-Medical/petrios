import { createHash, randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import * as apiPlatformDb from '@/lib/db/api-platform'

/**
 * Bearer-token auth for /api/v1. Tokens look like `bt_<48 hex chars>`; only
 * the sha256 hash is stored, so a database leak never leaks live tokens.
 * Every request resolves to an org — API access is always org-scoped, and
 * scope checks are explicit per route.
 */

export const API_SCOPES = [
  'read:sessions',
  'write:sessions',
  'read:attendance',
  'read:certificates',
  'read:departments',
  'read:slots',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const token = `bt_${randomBytes(24).toString('hex')}`
  return { token, hash: hashApiToken(token), prefix: `${token.slice(0, 7)}…` }
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export interface ApiAuthContext {
  orgId: string
  scopes: string[]
  tokenId: string
}

export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: message, code }, { status })
}

/**
 * Authenticate a v1 request and enforce a scope. Returns the auth context,
 * or a ready-to-return error response.
 */
export async function authenticateApiRequest(
  request: NextRequest,
  requiredScope: ApiScope
): Promise<ApiAuthContext | NextResponse> {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(bt_[a-f0-9]{48})$/i)
  if (!match) {
    return apiError(401, 'unauthorized', 'Provide an API token: Authorization: Bearer bt_…')
  }

  const token = await apiPlatformDb.findActiveTokenByHash(hashApiToken(match[1]))
  if (!token) {
    return apiError(401, 'unauthorized', 'Unknown or revoked API token')
  }

  if (!token.scopes.includes(requiredScope)) {
    return apiError(403, 'insufficient_scope', `This token lacks the ${requiredScope} scope`)
  }

  void apiPlatformDb.touchTokenLastUsed(token.id).catch(() => {})

  return { orgId: token.org_id, scopes: token.scopes, tokenId: token.id }
}
