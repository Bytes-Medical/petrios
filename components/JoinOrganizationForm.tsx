'use client'

import { Select } from './Select'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { createDepartmentJoinRequest } from '@/app/actions/join-requests'

interface OrganizationOption {
  id: string
  name: string
}

interface DepartmentOption {
  id: string
  name: string
  org_id: string
}

interface JoinOrganizationFormProps {
  organizations: OrganizationOption[]
  departmentsByOrg: Record<string, DepartmentOption[]>
}

export function JoinOrganizationForm({ organizations, departmentsByOrg }: JoinOrganizationFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    const form = e.currentTarget
    const formData = new FormData(e.currentTarget)
    const orgId = formData.get('org_id') as string
    const departmentId = formData.get('department_id') as string

    try {
      await createDepartmentJoinRequest(orgId, departmentId)
      setSuccess('Join request submitted. An admin will review it.')
      router.refresh()
      form.reset()
      setSelectedOrgId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit join request')
    } finally {
      setLoading(false)
    }
  }

  if (organizations.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">No organizations available yet.</p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 border border-green-500 bg-green-50">
          <p className="font-mono text-sm text-green-800">{success}</p>
        </div>
      )}

      <div className="space-y-1">
        <Select
          label="Organization"
          name="org_id"
          required
          value={selectedOrgId}
          onChange={(e) => setSelectedOrgId(e.target.value)}
        >
          <option value="">Select an organization</option>
          {organizations.map(org => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <Select label="Department" name="department_id" required disabled={!selectedOrgId}>
          <option value="">Select a department</option>
          {(departmentsByOrg[selectedOrgId] || []).map(dept => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" disabled={loading} className="w-full sm:w-auto">
        {loading ? 'Submitting...' : 'Request to Join'}
      </Button>
    </form>
  )
}
