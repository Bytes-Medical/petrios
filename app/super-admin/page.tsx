import { redirect } from 'next/navigation'
import { getCurrentUser, isSuperAdmin } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import {
  getAllDepartmentMemberships,
  getAllDepartments,
  getAllOrganizations,
  getAllOrganizationMemberships,
  getAllUsers,
  getSuperAdmins,
} from '@/app/actions/super-admin'
import { SuperAdminOrganizationForm } from '@/components/SuperAdminOrganizationForm'
import { SuperAdminDepartmentForm } from '@/components/SuperAdminDepartmentForm'
import { SuperAdminOrganizationsPanel } from '@/components/SuperAdminOrganizationsPanel'
import { SuperAdminUsersPanel } from '@/components/SuperAdminUsersPanel'
import { SuperAdminTabs } from '@/components/SuperAdminTabs'
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel'
import { getAllPendingDepartmentJoinRequests } from '@/app/actions/join-requests'

export default async function SuperAdminPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  const allowed = await isSuperAdmin()
  if (!allowed) {
    redirect('/dashboard')
  }

  const organizations = await getAllOrganizations()
  const departments = await getAllDepartments()
  const users = await getAllUsers()
  const superAdmins = await getSuperAdmins()
  const memberships = await getAllDepartmentMemberships()
  const orgMemberships = await getAllOrganizationMemberships()
  const joinRequests = await getAllPendingDepartmentJoinRequests()
  const superAdminIds = superAdmins.map(admin => admin.user_id)
  const departmentsById = departments.reduce(
    (acc: Record<string, { id: string; name: string }>, dept) => {
      acc[dept.id] = { id: dept.id, name: dept.name }
      return acc
    },
    {}
  )
  const departmentMembershipsByUser = memberships.reduce(
    (acc: Record<string, { department_id: string; department_name: string; role: string }[]>, m) => {
      const dept = m.departments ? { id: m.departments.id, name: m.departments.name } : departmentsById[m.department_id]
      if (!acc[m.user_id]) acc[m.user_id] = []
      acc[m.user_id].push({
        department_id: m.department_id,
        department_name: dept?.name || 'Unknown',
        role: m.role,
      })
      return acc
    },
    {}
  )
  const organizationMembershipsByUser = orgMemberships.reduce(
    (acc: Record<string, { org_id: string; org_name: string; role: string }[]>, m) => {
      if (!acc[m.user_id]) acc[m.user_id] = []
      acc[m.user_id].push({
        org_id: m.org_id,
        org_name: m.organizations?.name || 'Unknown',
        role: m.role,
      })
      return acc
    },
    {}
  )
  const departmentsByOrg = departments.reduce(
    (acc: Record<string, { id: string; name: string; org_id: string }[]>, dept) => {
      if (!acc[dept.org_id]) acc[dept.org_id] = []
      acc[dept.org_id].push(dept)
      return acc
    },
    {}
  )
  const organizationsWithDepartments = organizations.map(org => ({
    ...org,
    departments: departmentsByOrg[org.id] || [],
  }))

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Super Admin</h1>

        <SuperAdminTabs
          manage={
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
                <Card>
                  <h2 className="text-xl font-mono font-bold mb-4">Create Organization</h2>
                  <SuperAdminOrganizationForm />
                </Card>

                <Card>
                  <h2 className="text-xl font-mono font-bold mb-4">Create Department</h2>
                  <SuperAdminDepartmentForm organizations={organizations} />
                </Card>
              </div>

              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Organizations</h2>
                <SuperAdminOrganizationsPanel organizations={organizationsWithDepartments} />
              </Card>
            </div>
          }
          users={
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Users</h2>
              <SuperAdminUsersPanel
                users={users.map(user => ({ id: user.id, email: user.email }))}
                superAdminIds={superAdminIds}
                departments={departments.map(dept => ({ id: dept.id, name: dept.name }))}
                departmentMembershipsByUser={departmentMembershipsByUser}
                organizationMembershipsByUser={organizationMembershipsByUser}
                currentUserId={user.id}
              />
            </Card>
          }
          notifications={
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Join Requests</h2>
              <JoinRequestsPanel joinRequests={joinRequests} />
            </Card>
          }
        />
      </div>
    </div>
  )
}
