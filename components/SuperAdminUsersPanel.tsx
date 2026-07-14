'use client'

import { Select } from './Select'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { useToast } from './ToastProvider'
import { grantDepartmentModerator, grantSuperAdmin, revokeDepartmentModerator, revokeSuperAdmin, deleteUser } from '@/app/actions/super-admin'

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
  const { showToast } = useToast()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')

  const filteredUsers = users.filter(user => {
    const email = user.email || ''
    return email.toLowerCase().includes(query.toLowerCase()) || user.id.toLowerCase().includes(query.toLowerCase())
  })

  async function handleGrant(userId: string) {
    setLoadingId(userId)
    // toast handles feedback
    try {
      await grantSuperAdmin(userId)
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to grant super admin', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoadingId(null)
    }
  }

  async function handleRevoke(userId: string) {
    if (userId === currentUserId) {
      showToast({ variant: 'error', title: 'Cannot revoke your own access' })
      return
    }
    setLoadingId(userId)
    // toast handles feedback
    try {
      await revokeSuperAdmin(userId)
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to revoke super admin', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoadingId(null)
    }
  }

  async function handleGrantModerator(userId: string) {
    const departmentId = selectedDepartment[userId]
    if (!departmentId) {
      showToast({ variant: 'error', title: 'Select a department first' })
      return
    }
    setLoadingId(`${userId}-grant`)
    // toast handles feedback
    try {
      await grantDepartmentModerator(userId, departmentId)
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to grant moderator', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoadingId(null)
    }
  }

  async function handleRevokeModerator(userId: string, departmentId: string) {
    setLoadingId(`${userId}-revoke-${departmentId}`)
    // toast handles feedback
    try {
      await revokeDepartmentModerator(userId, departmentId)
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to revoke moderator', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoadingId(null)
    }
  }

  async function handleDeleteUser(userId: string, email: string | null) {
    if (userId === currentUserId) {
      showToast({ variant: 'error', title: 'Cannot delete your own account' })
      return
    }
    if (!confirm(`Permanently delete ${email || userId}? This cannot be undone.`)) return

    setLoadingId(`${userId}-delete`)
    // toast handles feedback
    try {
      await deleteUser(userId)
      router.refresh()
    } catch (err) {
      showToast({ variant: 'error', title: 'Failed to delete user', description: err instanceof Error ? err.message : undefined })
    } finally {
      setLoadingId(null)
    }
  }

  if (users.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No users found.</p>
  }

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search users by email or id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full px-3 py-2 border border-black font-mono text-sm bg-white"
        />
        <p className="mt-2 font-mono text-xs text-gray-500">
          A user can moderate departments in one organization only. Granting a
          role in another organization removes their previous moderator roles.
        </p>
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
                  {isSuper && <div className="text-gray-600">Super Admin</div>}
                  {!isSuper && orgMemberships.length > 0 && (
                    <div className="text-gray-600">
                      Org: {orgMemberships.map(m => m.org_name).join(', ')}
                    </div>
                  )}
                  {moderatorDepts.length > 0 && (
                    <div className="text-gray-600">
                      Moderator: {moderatorDepts.map(m => m.department_name).join(', ')}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {user.id !== currentUserId && (
                    <>
                      <div className="w-48">
                        <Select
                          aria-label="Department"
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
                        </Select>
                      </div>
                      <Button
                        type="button"
                        onClick={() => handleGrantModerator(user.id)}
                        disabled={loadingId === `${user.id}-grant`}
                      >
                        Grant Mod
                      </Button>
                    </>
                  )}
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
                    user.id !== currentUserId ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handleRevoke(user.id)}
                        disabled={loadingId === user.id}
                      >
                        Revoke Super
                      </Button>
                    ) : null
                  ) : (
                    <Button
                      type="button"
                      onClick={() => handleGrant(user.id)}
                      disabled={loadingId === user.id}
                    >
                      Grant Super
                    </Button>
                  )}
                  {user.id !== currentUserId && (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => handleDeleteUser(user.id, user.email)}
                      disabled={loadingId === `${user.id}-delete`}
                    >
                      {loadingId === `${user.id}-delete` ? 'Deleting...' : 'Delete'}
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
