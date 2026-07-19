'use client'

import { useState } from 'react'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import { sendPasswordlessLoginLink } from '@/app/actions/member-onboarding'

interface PasswordlessLoginFormProps {
  submitLabel?: string
  nextPath?: string
}

export function PasswordlessLoginForm({
  submitLabel = 'Email Me a Sign-In Link',
  nextPath = '/dashboard',
}: PasswordlessLoginFormProps) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await sendPasswordlessLoginLink(email, nextPath)
      if (response.success) {
        setSuccess(response.message)
      } else {
        setError(response.message)
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to send sign-in link')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="border border-red-500 bg-red-50 p-4">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="border border-black bg-white p-4">
          <h3 className="font-mono text-lg font-bold">Check Your Email</h3>
          <p className="mt-2 font-mono text-sm text-gray-600">{success}</p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <Button type="submit" variant="secondary" disabled={loading} className="w-full">
          {loading ? 'Sending link...' : submitLabel}
        </Button>
      </form>
    </div>
  )
}
