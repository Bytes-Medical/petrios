'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/client'
import { finalizeMemberOnboarding } from '@/app/actions/member-onboarding'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { safeNextPath } from '@/lib/safe-next-path'

/**
 * The page component is only a Suspense boundary. The real work lives in
 * `JoinCallbackInner` because `useSearchParams()` forces a client-side
 * bailout, which in Next.js 14 must be wrapped in <Suspense> so the
 * outer page can still be statically prerendered at build time.
 */
export default function JoinCallbackPage() {
  return (
    <Suspense fallback={<JoinCallbackFallback />}>
      <JoinCallbackInner />
    </Suspense>
  )
}

function JoinCallbackFallback() {
  return (
    <div className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <h1 className="font-mono text-2xl font-bold">Completing Access</h1>
          <p className="mt-3 font-mono text-sm text-gray-600">
            Hold on while we finish signing you in and attach your membership.
          </p>
        </Card>
      </div>
    </div>
  )
}

function JoinCallbackInner() {
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const mode = searchParams.get('mode')
  const loginHref = '/login'

  useEffect(() => {
    let cancelled = false

    async function completeCallback() {
      try {
        const supabase = createSupabaseClient()
        const code = searchParams.get('code')
        const tokenHash = searchParams.get('token_hash')
        const type = searchParams.get('type')
        const requestId = searchParams.get('requestId')
        const mode = searchParams.get('mode')
        const next = safeNextPath(searchParams.get('next'))

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) {
            throw exchangeError
          }
        } else if (tokenHash && type) {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email',
          })
          if (verifyError) {
            throw verifyError
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 300))

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (userError) {
          throw userError
        }

        if (!user) {
          throw new Error('No authenticated session was created')
        }

        if (requestId) {
          await finalizeMemberOnboarding(requestId)
          if (!cancelled) {
            window.location.replace('/dashboard')
          }
          return
        }

        if (!cancelled) {
          window.location.replace(mode === 'login' ? next : '/dashboard')
        }
      } catch (callbackError) {
        if (!cancelled) {
          setError(
            callbackError instanceof Error
              ? callbackError.message
              : 'Failed to complete sign-in'
          )
        }
      }
    }

    completeCallback()

    return () => {
      cancelled = true
    }
  }, [searchParams])

  if (error) {
    return (
      <div className="min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          <Card>
            <h1 className="font-mono text-2xl font-bold">Authentication Failed</h1>
            <p className="mt-3 font-mono text-sm text-gray-600">{error}</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link href={loginHref}>
                <Button type="button">
                  {mode === 'login' ? 'Go to Trainee Sign-In' : 'Go to Login'}
                </Button>
              </Link>
              <Link href="/dashboard" className="font-mono text-sm underline self-center">
                Back to Dashboard
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <h1 className="font-mono text-2xl font-bold">Completing Access</h1>
          <p className="mt-3 font-mono text-sm text-gray-600">
            Hold on while we finish signing you in and attach your membership.
          </p>
        </Card>
      </div>
    </div>
  )
}
