import type { DepartmentMemberWithProfile } from '@/app/actions/departments'

interface DepartmentMembersPanelProps {
  departmentName: string
  members: DepartmentMemberWithProfile[]
}

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Admin',
  department_admin: 'Moderator',
  faculty: 'Faculty',
  trainee: 'Trainee',
}

export function DepartmentMembersPanel({ departmentName, members }: DepartmentMembersPanelProps) {
  if (members.length === 0) {
    return <p className="font-mono text-sm text-gray-400">No members in this department yet.</p>
  }

  return (
    <div>
      <p className="mb-3 font-mono text-sm text-gray-600">
        {members.length} member{members.length !== 1 ? 's' : ''} in {departmentName}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Email</th>
              <th className="pb-2 pr-4">Grade</th>
              <th className="pb-2">Role</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const name =
                m.full_name ||
                [m.first_name, m.last_name].filter(Boolean).join(' ') ||
                '—'
              return (
                <tr key={m.user_id} className="border-b border-gray-200">
                  <td className="py-2 pr-4">{name}</td>
                  <td className="py-2 pr-4 text-gray-500">{m.email}</td>
                  <td className="py-2 pr-4">{m.grade || '—'}</td>
                  <td className="py-2">
                    <span className="inline-block bg-gray-100 px-2 py-0.5 text-xs">
                      {ROLE_LABELS[m.role] || m.role}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
