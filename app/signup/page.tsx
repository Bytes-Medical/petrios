'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createSupabaseClient } from '@/lib/supabase/client'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import Link from 'next/link'
import { Wordmark } from '@/components/Wordmark'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(true)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setLoading(false)
      return
    }

    try {
      const supabase = createSupabaseClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      })

      if (signUpError) {
        setError(signUpError.message)
        setLoading(false)
        return
      }

      if (data.session) {
        // Session created immediately (email confirmation disabled)
        const { data: { session: verifiedSession } } = await supabase.auth.getSession()
        
        if (verifiedSession) {
          window.location.href = '/dashboard'
        } else {
          setError('Session not established. Please try logging in.')
          setLoading(false)
        }
      } else {
        // Email confirmation required
        setSuccess(`Account created! Please check your email (${email}) for a confirmation link.`)
        setShowForm(false)
        setLoading(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md border border-black p-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <Wordmark size="lg" />
        </div>
        <h2 className="text-lg sm:text-xl font-mono font-bold mb-4 sm:mb-6 text-center">Sign Up</h2>
        
        {error && (
          <div className="p-4 border border-red-500 bg-red-50 mb-4">
            <p className="font-mono text-sm text-red-800">{error}</p>
          </div>
        )}

        {success && (
          <div className="p-6 border border-green-500 bg-green-50 mb-6">
            <h3 className="font-mono font-bold text-green-800 mb-2">✓ Account Created Successfully!</h3>
            <p className="font-mono text-sm text-green-800 mb-4">{success}</p>
            <p className="font-mono text-sm text-green-700 mb-4">
              After clicking the confirmation link in your email, you can sign in with your staff account.
            </p>
            <Link href="/login">
              <Button variant="primary" className="w-full">
                Go to Staff Login
              </Button>
            </Link>
          </div>
        )}

        {showForm && (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <Input
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing up...' : 'Sign Up'}
              </Button>
            </form>

            <p className="font-mono text-sm mt-4 text-center">
              Already have a staff account?{' '}
              <Link href="/login" className="underline">
                Staff Login
              </Link>
            </p>
            <p className="font-mono text-sm mt-2 text-center text-gray-600">
              Trainee with an invite?{' '}
              <Link href="/login" className="underline text-black">
                Use trainee sign-in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
