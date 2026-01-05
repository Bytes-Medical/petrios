import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isOrgAdmin } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getDepartments, getMyModeratedDepartment } from '@/app/actions/departments'
import { DepartmentForm } from '@/components/DepartmentForm'
import { OrganizationForm } from '@/components/OrganizationForm'
import { JoinOrganizationForm } from '@/components/JoinOrganizationForm'
import { JoinRequestsPanel } from '@/components/JoinRequestsPanel'
import {
  getPendingDepartmentJoinRequests,
  getOrganizationsForJoin,
  getDepartmentsForOrg,
} from '@/app/actions/join-requests'
import { isSuperAdmin } from '@/lib/auth'

export default async function AdminPage() {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  // Get departments if we have an org
  let departments: any[] = []
  if (orgId) {
    try {
      departments = await getDepartments()
    } catch (error) {
      console.error('Error fetching departments:', error)
    }
  }

  let moderatedDept: { id: string; name: string } | null = null
  try {
    moderatedDept = await getMyModeratedDepartment()
  } catch (error) {
    console.error('Error fetching moderated department:', error)
  }

  const superAdmin = await isSuperAdmin()
  const orgAdmin = await isOrgAdmin()

  let joinRequests: any[] = []
  if (orgId) {
    try {
      joinRequests = await getPendingDepartmentJoinRequests()
    } catch (error) {
      console.error('Error fetching join requests:', error)
    }
  }

  let organizationsForJoin: any[] = []
  let departmentsByOrg: Record<string, any[]> = {}
  if (!orgId) {
    try {
      organizationsForJoin = await getOrganizationsForJoin()
      const departmentsList = await Promise.all(
        organizationsForJoin.map((org: { id: string }) => getDepartmentsForOrg(org.id))
      )
      departmentsByOrg = organizationsForJoin.reduce(
        (acc: Record<string, any[]>, org: { id: string }, index: number) => {
          acc[org.id] = departmentsList[index]
          return acc
        },
        {}
      )
    } catch (error) {
      console.error('Error fetching organizations:', error)
    }
  }

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Admin Panel</h1>

        {!orgId ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Join a Department</h2>
              <p className="font-mono text-sm text-gray-600 mb-4">
                Request access to a department. An admin will approve your request.
              </p>
              <JoinOrganizationForm
                organizations={organizationsForJoin}
                departmentsByOrg={departmentsByOrg}
              />
            </Card>

            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Create Organization</h2>
              <p className="font-mono text-sm text-gray-600 mb-4">
                Only super admins can create organizations.
              </p>
              {superAdmin ? <OrganizationForm /> : (
                <p className="font-mono text-sm text-gray-600">
                  Contact your super admin for access.
                </p>
              )}
            </Card>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
              {(superAdmin || orgAdmin) && (
                <Card>
                  <h2 className="text-xl font-mono font-bold mb-4">Create Department</h2>
                  <DepartmentForm />
                </Card>
              )}

              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Departments</h2>
                {departments.length === 0 ? (
                  <p className="font-mono text-sm text-gray-600">No departments yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {departments.map(dept => (
                      <li key={dept.id} className="font-mono text-sm">
                        <a
                          href={`/departments/${dept.id}/sessions`}
                          className="hover:underline"
                        >
                          {dept.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Join Requests</h2>
                <JoinRequestsPanel joinRequests={joinRequests} />
              </Card>
            </div>

            {moderatedDept && !orgAdmin && (
              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Moderator Tools</h2>
                <p className="font-mono text-sm text-gray-600 mb-4">
                  Manage sessions for {moderatedDept.name}.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a
                    href={`/departments/${moderatedDept.id}/sessions/new`}
                    className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50"
                  >
                    Create Session
                  </a>
                  <a
                    href={`/departments/${moderatedDept.id}/sessions`}
                    className="px-4 py-2 border border-gray-400 bg-white text-black font-mono text-sm hover:bg-gray-50"
                  >
                    View Sessions
                  </a>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
