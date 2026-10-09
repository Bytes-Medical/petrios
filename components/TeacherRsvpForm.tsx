'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { respondToInvitation } from '@/app/actions/teacher-invitations'

interface TeacherRsvpFormProps {
  inviteCode: string
}

export function TeacherRsvpForm({ inviteCode }: TeacherRsvpFormProps) {
  const router = useRouter()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function handleSubmit(accepted: boolean) {
    if (!firstName.trim() || !lastName.trim()) {
      setError('Please enter your first and last name')
      return
    }

    setLoading(accepted ? 'accept' : 'decline')
    setError(null)

    try {
      const response = await respondToInvitation(inviteCode, firstName, lastName, accepted)
      if (!response.ok) {
        setError(response.message)
        if (response.final) router.refresh()
        return
      }
      setResult(response.status === 'ACCEPTED'
        ? 'Thank you! You have accepted the invitation.'
        : 'You have declined the invitation.'
      )
    } catch {
      // Production masks unexpected action errors, so their text is never useful here.
      setError('Something went wrong while sending your response. Please try again in a moment.')
    } finally {
      setLoading(null)
    }
  }

  if (result) {
    return (
      <div className="p-4 border border-green-500 bg-green-50">
        <p className="font-mono text-sm text-green-800">{result}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm">
        Please enter your name and confirm your participation. Your name will be used on the teaching certificate.
      </p>

      {error && (
        <div role="alert" className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="First Name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="Enter your first name"
          required
        />
        <Input
          label="Last Name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Enter your last name"
          required
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => handleSubmit(true)}
          disabled={loading !== null}
        >
          {loading === 'accept' ? 'Submitting...' : 'Accept Invitation'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleSubmit(false)}
          disabled={loading !== null}
        >
          {loading === 'decline' ? 'Submitting...' : 'Decline'}
        </Button>
      </div>
    </div>
  )
}
