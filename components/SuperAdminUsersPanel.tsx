'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { grantDepartmentModerator, grantSuperAdmin, revokeDepartmentModerator, revokeSuperAdmin } from '@/app/actions/super-admin'

interface UserItem {
  id: string
  email: string | null
}

interface DepartmentOption {
  id: string
  name: string
}

interface DepartmentMembership {
  department_id: string
  department_name: string
  role: string
}

interface OrganizationMembership {
  org_id: string
  org_name: string
  role: string
}

interface SuperAdminUsersPanelProps {
  users: UserItem[]
  superAdminIds: string[]
  departments: DepartmentOption[]
  departmentMembershipsByUser: Record<string, DepartmentMembership[]>
  organizationMembershipsByUser: Record<string, OrganizationMembership[]>
  currentUserId?: string
}

export function SuperAdminUsersPanel({
  users,
  superAdminIds,
  departments,
  departmentMembershipsByUser,
  organizationMembershipsByUser,
  currentUserId,
}: SuperAdminUsersPanelProps) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')

  const filteredUsers = users.filter(user => {
    const email = user.email || ''
    return email.toLowerCase().includes(query.toLowerCase()) || user.id.toLowerCase().includes(query.toLowerCase())
  })

  async function handleGrant(userId: string) {
    setLoadingId(userId)
    setError(null)
    try {
      await grantSuperAdmin(userId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant super admin')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleRevoke(userId: string) {
    if (userId === currentUserId) {
      setError('You cannot revoke your own super admin access.')
      return
    }
    setLoadingId(userId)
    setError(null)
    try {
      await revokeSuperAdmin(userId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke super admin')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleGrantModerator(userId: string) {
    const departmentId = selectedDepartment[userId]
    if (!departmentId) {
      setError('Select a department to grant moderator access.')
      return
    }
    setLoadingId(`${userId}-grant`)
    setError(null)
    try {
      await grantDepartmentModerator(userId, departmentId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grant moderator')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleRevokeModerator(userId: string, departmentId: string) {
    setLoadingId(`${userId}-revoke-${departmentId}`)
    setError(null)
    try {
      await revokeDepartmentModerator(userId, departmentId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke moderator')
    } finally {
      setLoadingId(null)
    }
  }

  if (users.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No users found.</p>
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users by email or id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 border border-black font-mono text-sm bg-white"
        />
      </div>

      <ul className="space-y-2">
        {filteredUsers.map(user => {
          const isSuper = superAdminIds.includes(user.id)
          const memberships = departmentMembershipsByUser[user.id] || []
          const moderatorDepts = memberships.filter(m => m.role === 'department_admin')
          const orgMemberships = organizationMembershipsByUser[user.id] || []
          return (
            <li key={user.id} className="border border-black p-3">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="font-mono text-sm">
                  <div className="font-bold">{user.email || user.id}</div>
                  {orgMemberships.length > 0 && (
                    <div className="text-gray-600">
                      Org: {orgMemberships.map(m => m.org_name).join(', ')}
                    </div>
                  )}
                  {isSuper && <div className="text-gray-600">Super Admin</div>}
                  {moderatorDepts.length > 0 && (
                    <div className="text-gray-600">
                      Moderator: {moderatorDepts.map(m => m.department_name).join(', ')}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <select
                    className="px-3 py-2 border border-black font-mono text-sm bg-white"
                    value={selectedDepartment[user.id] || ''}
                    onChange={(e) =>
                      setSelectedDepartment(prev => ({ ...prev, [user.id]: e.target.value }))
                    }
                  >
                    <option value="">Select dept</option>
                    {departments.map(dept => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    onClick={() => handleGrantModerator(user.id)}
                    disabled={loadingId === `${user.id}-grant`}
                  >
                    Grant Mod
                  </Button>
                  {moderatorDepts.map(m => (
                    <Button
                      key={`${user.id}-${m.department_id}`}
                      type="button"
                      variant="secondary"
                      onClick={() => handleRevokeModerator(user.id, m.department_id)}
                      disabled={loadingId === `${user.id}-revoke-${m.department_id}`}
                    >
                      Revoke {m.department_name}
                    </Button>
                  ))}
                  {isSuper ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleRevoke(user.id)}
                      disabled={loadingId === user.id}
                    >
                      Revoke Super
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={() => handleGrant(user.id)}
                      disabled={loadingId === user.id}
                    >
                      Grant Super
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
