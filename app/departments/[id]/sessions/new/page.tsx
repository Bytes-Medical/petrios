import { redirect } from 'next/navigation'
import { getCurrentUser, getCurrentOrgId, isDepartmentModerator } from '@/lib/auth'
import { NavShell } from '@/components/NavShell'
import { Card } from '@/components/Card'
import { getDepartment } from '@/app/actions/departments'
import { SessionForm } from '@/components/SessionForm'

export default async function NewSessionPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const user = await getCurrentUser()

  if (!user) {
    redirect('/login')
  }

  const orgId = await getCurrentOrgId()

  if (!orgId) {
    redirect('/dashboard')
  }

  // Check if user is a moderator for this department
  const canManage = await isDepartmentModerator(params.id)
  if (!canManage) {
    redirect(`/departments/${params.id}/sessions`)
  }

  const department = await getDepartment(params.id)

  return (
    <div className="min-h-screen">
      <NavShell />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl sm:text-3xl font-mono font-bold mb-6 sm:mb-8">Create Session</h1>
        <Card>
          <SessionForm departmentId={params.id} departmentName={department.name} />
        </Card>
      </div>
    </div>
  )
}
