'use client'

import { useState } from 'react'
import { getMicrosoftSignInUrl } from '@/app/actions/auth'

/**
 * "Continue with Microsoft" — Entra ID SSO, which covers NHSmail accounts.
 * The server action returns the provider redirect URL (or an error when the
 * Azure provider isn't configured on this deployment); we navigate to it.
 */
export function MicrosoftSignInButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    try {
      const result = await getMicrosoftSignInUrl()
      if (result.url) {
        window.location.href = result.url
        return
      }
      setError(result.error ?? 'Microsoft sign-in is not available right now.')
    } catch {
      setError('Microsoft sign-in is not available right now.')
    }
    setLoading(false)
  }

  return (
    <div>
      {error && (
        <div className="mb-3 border border-red-500 bg-red-50 p-3">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 border border-black bg-white px-4 py-2.5 font-mono text-sm hover:bg-gray-50 disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="0" y="0" width="7.5" height="7.5" fill="#F25022" />
          <rect x="8.5" y="0" width="7.5" height="7.5" fill="#7FBA00" />
          <rect x="0" y="8.5" width="7.5" height="7.5" fill="#00A4EF" />
          <rect x="8.5" y="8.5" width="7.5" height="7.5" fill="#FFB900" />
        </svg>
        {loading ? 'Redirecting…' : 'Continue with Microsoft'}
      </button>
      <p className="mt-1.5 text-center font-mono text-xs text-gray-500">
        Works with NHSmail accounts
      </p>
    </div>
  )
}
