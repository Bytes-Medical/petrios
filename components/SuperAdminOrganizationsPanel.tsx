'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { deleteDepartment, deleteOrganization } from '@/app/actions/super-admin'

interface DepartmentItem {
  id: string
  name: string
  org_id: string
}

interface OrganizationItem {
  id: string
  name: string
  departments: DepartmentItem[]
}

interface SuperAdminOrganizationsPanelProps {
  organizations: OrganizationItem[]
}

export function SuperAdminOrganizationsPanel({ organizations }: SuperAdminOrganizationsPanelProps) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleDeleteOrganization(orgId: string) {
    if (!confirm('Delete this organization and all related data?')) return
    setLoadingId(orgId)
    setError(null)
    try {
      await deleteOrganization(orgId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete organization')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleDeleteDepartment(departmentId: string) {
    if (!confirm('Delete this department and all related data?')) return
    setLoadingId(departmentId)
    setError(null)
    try {
      await deleteDepartment(departmentId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete department')
    } finally {
      setLoadingId(null)
    }
  }

  if (organizations.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">No organizations yet.</p>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <ul className="space-y-4">
        {organizations.map(org => (
          <li key={org.id} className="border border-black p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="font-mono font-bold">{org.name}</div>
                <div className="font-mono text-xs text-gray-600">Departments</div>
              </div>
              <Button
                type="button"
                variant="danger"
                onClick={() => handleDeleteOrganization(org.id)}
                disabled={loadingId === org.id}
              >
                Delete Org
              </Button>
            </div>

            {org.departments.length === 0 ? (
              <p className="font-mono text-sm text-gray-600 mt-3">No departments.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {org.departments.map(dept => (
                  <li key={dept.id} className="flex items-center justify-between gap-4">
                    <span className="font-mono text-sm">{dept.name}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleDeleteDepartment(dept.id)}
                      disabled={loadingId === dept.id}
                    >
                      Delete Dept
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
