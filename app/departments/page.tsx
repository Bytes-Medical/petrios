import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getDepartments } from '@/app/actions/departments'
import Link from 'next/link'

export default async function DepartmentsPage() {
  const user = await getCurrentUser()
  
  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  const departments = await getDepartments()

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-mono font-bold">Departments</h1>
          <Link
            href="/admin"
            className="px-4 py-2 border border-black bg-black text-white font-mono text-sm hover:bg-gray-900 whitespace-nowrap"
          >
            Create Department
          </Link>
        </div>

        {departments.length === 0 ? (
          <Card>
            <p className="font-mono text-sm">No departments yet. Create one in the admin panel.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {departments.map(dept => (
              <Card key={dept.id}>
                <h2 className="text-xl font-mono font-bold mb-2">{dept.name}</h2>
                <p className="font-mono text-sm text-gray-600 mb-4">
                  Created {new Date(dept.created_at).toLocaleDateString()}
                </p>
                <Link
                  href={`/departments/${dept.id}/sessions`}
                  className="font-mono text-sm underline"
                >
                  View Sessions →
                </Link>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
