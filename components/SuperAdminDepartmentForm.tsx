'use client'

import { Select } from './Select'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Button } from './Button'
import { createDepartmentForOrg } from '@/app/actions/super-admin'

interface OrganizationOption {
  id: string
  name: string
}

interface SuperAdminDepartmentFormProps {
  organizations: OrganizationOption[]
}

export function SuperAdminDepartmentForm({ organizations }: SuperAdminDepartmentFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = e.currentTarget
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const orgId = formData.get('org_id') as string

    try {
      await createDepartmentForOrg(orgId, name)
      router.refresh()
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department')
    } finally {
      setLoading(false)
    }
  }

  if (organizations.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">No organizations available.</p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="space-y-1">
        <label className="block mb-1 text-sm font-mono">Organization</label>
        <Select name="org_id" required>
          <option value="">Select an organization</option>
          {organizations.map(org => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      </div>

      <Input
        label="Department Name"
        name="name"
        required
      />

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Department'}
      </Button>
    </form>
  )
}
