'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { PasswordlessLoginForm } from '@/components/PasswordlessLoginForm'
import { MicrosoftSignInButton } from '@/components/MicrosoftSignInButton'
import { INDIVIDUAL_SIGNUP_ENABLED } from '@/lib/flags'
import { Wordmark } from '@/components/Wordmark'

export type LoginVariant = 'individual' | 'organisation' | 'neutral'

/**
 * Single source of truth for the sign-in card, rendered by three thin routes:
 *   /login              -> neutral (middleware fallback; offers both doors)
 *   /login/individual   -> solo educators (auto personal workspace on first login)
 *   /login/organisation -> trust/programme members (sign in OR join with a code)
 *
 * Auth is mechanically identical across variants (passwordless magic link); the
 * variants differ in copy, the join-with-code path, and the password toggle
 * (admins only — individuals are passwordless).
 */
export function LoginCard({
  variant,
  nextPath = '/dashboard',
}: {
  variant: LoginVariant
  nextPath?: string
}) {
  const isIndividual = variant === 'individual'
  const isOrg = variant === 'organisation'
  const allowPassword = variant !== 'individual'

  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 200))
      window.location.replace(nextPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
    }
  }

  const heading = isIndividual ? 'Start teaching' : isOrg ? 'Organisation sign-in' : 'Sign in'
  const subtitle = isIndividual
    ? "Enter your email for a sign-in link. First time here? We'll set up your personal teaching space automatically."
    : isOrg
      ? 'Sign in with your work email, or join your programme with a department code.'
      : 'Enter your email to receive a sign-in link.'
  const formLabel = isIndividual ? 'Create my teaching space →' : 'Email me a sign-in link'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-dotgrid">
      <div className="w-full max-w-md border border-black border-t-4 border-t-clay-600 bg-white p-6 sm:p-8 shadow-[8px_8px_0_rgba(31,29,26,0.08)]">
        <div className="flex justify-center mb-6">
          <Wordmark size="lg" />
        </div>

        <h2 className="text-lg sm:text-xl font-mono font-bold mb-2 text-center">{heading}</h2>
        <p className="mb-6 text-center font-mono text-sm text-gray-600">{subtitle}</p>

        {isOrg && !showPassword && (
          <p className="mb-3 font-mono text-xs uppercase tracking-wide text-gray-500">
            Already a member?
          </p>
        )}

        {/* Passwordless login (default) */}
        {!showPassword && (
          <>
            <PasswordlessLoginForm submitLabel={formLabel} nextPath={nextPath} />
            <div className="my-4 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-gray-300" />
              <span className="font-mono text-xs text-gray-500">or</span>
              <div className="h-px flex-1 bg-gray-300" />
            </div>
            <MicrosoftSignInButton nextPath={nextPath} />
          </>
        )}

        {/* Password login (admin toggle, not offered to individuals) */}
        {showPassword && allowPassword && (
          <>
            {error && (
              <div className="mb-4 border border-red-500 bg-red-50 p-4">
                <p className="font-mono text-sm text-red-800">{error}</p>
              </div>
            )}
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Input
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </>
        )}

        {/* Organisation: prominent join-with-code path */}
        {isOrg && (
          <div className="mt-6 border-t border-gray-200 pt-6">
            <p className="mb-1 font-mono text-sm font-bold">New to your programme?</p>
            <p className="mb-3 font-mono text-sm text-gray-600">
              Use the department code from your teaching lead.
            </p>
            <Link href="/join/dept">
              <Button variant="secondary" className="w-full">
                Join with a department code
              </Button>
            </Link>
          </div>
        )}

        {/* Admin password toggle */}
        {allowPassword && (
          <div className="mt-6 border-t border-gray-200 pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setShowPassword(!showPassword)
                setError(null)
              }}
              className="font-mono text-xs text-gray-400 underline"
            >
              {showPassword ? 'Use magic link instead' : 'Admin? Sign in with password'}
            </button>
          </div>
        )}

        {/* Cross-links to the other door — only when individual signup is on */}
        {INDIVIDUAL_SIGNUP_ENABLED && (
          <div className="mt-4 text-center font-mono text-sm">
            {isIndividual && (
              <Link href="/login/organisation" className="underline">
                Part of an organisation? Sign in here
              </Link>
            )}
            {isOrg && (
              <Link href="/login/individual" className="underline">
                Just teaching on your own? Start here
              </Link>
            )}
            {variant === 'neutral' && (
              <div className="flex flex-col gap-2">
                <Link href="/login/individual" className="underline">
                  Teaching on your own? Start here
                </Link>
                <Link href="/login/organisation" className="underline">
                  Part of an organisation? Sign in here
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
