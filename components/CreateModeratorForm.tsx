'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { Button } from '@/components/Button'
import { useToast } from '@/components/ToastProvider'
import { createModeratorAccount } from '@/app/actions/super-admin'

interface CreateModeratorFormProps {
  departments: { id: string; name: string; orgName: string }[]
}

export function CreateModeratorForm({ departments }: CreateModeratorFormProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [email, setEmail] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      const result = await createModeratorAccount({ email, departmentId })

      if (result.isNewUser) {
        showToast({ variant: 'success', title: 'Magic link sent', description: `${email} will be a moderator when they sign in.` })
      } else {
        showToast({ variant: 'success', title: 'Moderator granted', description: `${email} has been upgraded and notified.` })
      }

      setEmail('')
      setDepartmentId('')
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to create moderator', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Department"
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          required
        >
          <option value="">Select a department</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.orgName})
            </option>
          ))}
        </Select>

        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="moderator@example.com"
          required
        />

        <p className="font-mono text-xs text-gray-500">
          If the email is already registered, their role will be upgraded. If
          not, they will receive a magic link to create their account. Granting
          access here removes moderator access in any other organization.
        </p>

        <Button type="submit" disabled={loading || !departmentId || !email}>
          {loading ? 'Processing...' : 'Grant Moderator Access'}
        </Button>
      </form>
    </div>
  )
}
