'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createApiToken,
  revokeOrgApiToken,
  type SafeApiToken,
} from '@/app/actions/api-platform'
import { API_SCOPES } from '@/lib/api/scopes'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'

interface ApiTokensPanelProps {
  tokens: SafeApiToken[]
}

/** Org-admin management of /api/v1 bearer tokens (docs/api.md). */
export function ApiTokensPanel({ tokens }: ApiTokensPanelProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<string[]>(['read:sessions'])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleScope(scope: string) {
    setScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    )
  }

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const result = await createApiToken(name, scopes)
      setNewToken(result.token)
      setName('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token')
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(id: string) {
    setError(null)
    try {
      await revokeOrgApiToken(id)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token')
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Bearer tokens for the public API (<code>/api/v1</code>, see{' '}
        <a href="/openapi.json" className="underline">openapi.json</a>). Tokens
        are org-scoped and shown once.
      </p>

      {error && (
        <p className="border border-red-700 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">{error}</p>
      )}

      {newToken && (
        <div className="border border-green-700 bg-green-50 px-3 py-2">
          <p className="font-mono text-xs font-bold text-green-800">
            Copy this token now — it will not be shown again:
          </p>
          <p className="mt-1 break-all font-mono text-xs">{newToken}</p>
          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-1 font-mono text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="space-y-2 border border-black p-4">
        <Input
          label="Token name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. rota-system-integration"
        />
        <div className="flex flex-wrap gap-2 pt-1">
          {API_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-1.5 font-mono text-xs">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {scope}
            </label>
          ))}
        </div>
        <Button size="sm" onClick={handleCreate} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create token'}
        </Button>
      </div>

      {tokens.length > 0 && (
        <div className="divide-y divide-gray-200 border border-gray-200">
          {tokens.map((token) => (
            <div key={token.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-bold">
                  {token.name}{' '}
                  <span className="font-normal text-gray-500">{token.token_prefix}</span>
                </p>
                <p className="font-mono text-xs text-gray-500">
                  {token.scopes.join(', ')} ·{' '}
                  {token.last_used_at
                    ? `last used ${new Date(token.last_used_at).toLocaleDateString('en-GB')}`
                    : 'never used'}
                </p>
              </div>
              {token.revoked_at ? (
                <Badge>revoked</Badge>
              ) : (
                <Button size="sm" variant="danger" onClick={() => handleRevoke(token.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
