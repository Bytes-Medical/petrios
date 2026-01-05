'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Select } from './Select'
import { addSessionTeacher, removeSessionTeacher } from '@/app/actions/sessions'

interface ManageTeachersPanelProps {
  sessionId: string
  currentTeachers: { id: string; user_id: string }[]
  departmentMembers: { id: string; email: string | null }[]
}

export function ManageTeachersPanel({
  sessionId,
  currentTeachers,
  departmentMembers,
}: ManageTeachersPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')

  const currentTeacherIds = currentTeachers.map(t => t.user_id)
  const availableMembers = departmentMembers.filter(m => !currentTeacherIds.includes(m.id))

  async function handleAddTeacher() {
    if (!selectedUserId) return

    setLoading('add')
    setError(null)

    try {
      await addSessionTeacher(sessionId, selectedUserId)
      setSelectedUserId('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add teacher')
    } finally {
      setLoading(null)
    }
  }

  async function handleRemoveTeacher(userId: string) {
    setLoading(`remove-${userId}`)
    setError(null)

    try {
      await removeSessionTeacher(sessionId, userId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove teacher')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div>
        <h3 className="font-mono font-bold mb-2">Current Teachers</h3>
        {currentTeachers.length === 0 ? (
          <p className="font-mono text-sm text-gray-600">No teachers assigned yet.</p>
        ) : (
          <ul className="space-y-2">
            {currentTeachers.map(teacher => {
              const member = departmentMembers.find(m => m.id === teacher.user_id)
              return (
                <li key={teacher.id} className="flex items-center justify-between p-2 border border-gray-300">
                  <span className="font-mono text-sm">{member?.email || teacher.user_id}</span>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => handleRemoveTeacher(teacher.user_id)}
                    disabled={loading === `remove-${teacher.user_id}`}
                    className="text-xs"
                  >
                    {loading === `remove-${teacher.user_id}` ? 'Removing...' : 'Remove'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {availableMembers.length > 0 && (
        <div>
          <h3 className="font-mono font-bold mb-2">Add Teacher</h3>
          <div className="flex gap-2">
            <Select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="flex-1"
            >
              <option value="">Select a department member</option>
              {availableMembers.map(member => (
                <option key={member.id} value={member.id}>
                  {member.email || member.id}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              onClick={handleAddTeacher}
              disabled={!selectedUserId || loading === 'add'}
            >
              {loading === 'add' ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
