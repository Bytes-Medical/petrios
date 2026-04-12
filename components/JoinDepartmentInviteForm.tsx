'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { beginDepartmentOnboarding } from '@/app/actions/member-onboarding'
import { TRAINEE_GRADES } from '@/lib/types'

interface JoinDepartmentInviteFormProps {
  inviteCode: string
  organizationName: string
  departmentName: string
  initialEmail?: string
  initialFirstName?: string
  initialLastName?: string
  isSignedIn?: boolean
}

interface PendingConfirmation {
  currentOrgName: string
  targetOrgName: string
}

export function JoinDepartmentInviteForm({
  inviteCode,
  organizationName,
  departmentName,
  initialEmail = '',
  initialFirstName = '',
  initialLastName = '',
  isSignedIn = false,
}: JoinDepartmentInviteFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [grade, setGrade] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null)

  async function submit(confirmOrgSwitch = false) {
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const result = await beginDepartmentOnboarding({
        inviteCode,
        email,
        firstName,
        lastName,
        grade: grade || undefined,
        confirmOrgSwitch,
      })

      if (result.status === 'confirm-switch') {
        setPendingConfirmation({
          currentOrgName: result.currentOrgName,
          targetOrgName: result.targetOrgName,
        })
        return
      }

      setPendingConfirmation(null)

      if (result.status === 'joined') {
        window.location.replace(result.redirectTo)
        return
      }

      setSuccess(result.message)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to process invite')
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submit(false)
  }

  return (
    <div className="space-y-6">
      <div className="border border-black bg-white p-4">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-gray-500">Invite</p>
        <h2 className="mt-2 font-mono text-2xl font-bold">{departmentName}</h2>
        <p className="mt-2 font-mono text-sm text-gray-600">
          Join {departmentName} in {organizationName}.
        </p>
        {isSignedIn ? (
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.2em] text-gray-500">
            Signed in users matching this email can join instantly.
          </p>
        ) : null}
      </div>

      {pendingConfirmation ? (
        <div className="border border-black bg-white p-4">
          <h3 className="font-mono text-lg font-bold">Confirm Organization Move</h3>
          <p className="mt-3 font-mono text-sm text-gray-600">
            This email already belongs to {pendingConfirmation.currentOrgName}. Continuing will
            move the account into {pendingConfirmation.targetOrgName} and remove access from the
            previous organization.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={() => submit(true)} disabled={loading}>
              {loading ? 'Continuing...' : 'Continue'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => setPendingConfirmation(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border border-black bg-white p-4">
          <p className="font-mono text-sm">{error}</p>
        </div>
      ) : null}

      {success ? (
        <div className="border border-black bg-white p-4">
          <h3 className="font-mono text-lg font-bold">Check Your Email</h3>
          <p className="mt-3 font-mono text-sm text-gray-600">{success}</p>
          <p className="mt-3 font-mono text-sm text-gray-600">
            After opening the link, you will finish joining this department and land on your dashboard.
          </p>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4 border border-black bg-white p-4 sm:p-6">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="First Name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            required
          />
          <Input
            label="Last Name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
          />
        </div>
        <Select
          label="Grade"
          value={grade}
          onChange={(event) => setGrade(event.target.value)}
        >
          <option value="">Select your grade (optional)</option>
          {TRAINEE_GRADES.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="submit" disabled={loading}>
            {loading ? 'Processing...' : 'Join Department'}
          </Button>
          <Link href="/trainee-login" className="font-mono text-sm underline">
            Already have access? Sign in
          </Link>
        </div>
      </form>
    </div>
  )
}
