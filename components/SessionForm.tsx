'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Textarea } from './Textarea'
import { Select } from './Select'
import { Button } from './Button'
import { createSession } from '@/app/actions/sessions'
import { assertValidSessionDates } from '@/lib/session-validation'
import { SESSION_TYPES, SESSION_TYPE_LABELS } from '@/lib/types'

interface SessionFormProps {
  departmentId: string
  departmentName: string
}

export function SessionForm({ departmentId, departmentName }: SessionFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    try {
      const dateStart = new Date(formData.get('date_start') as string).toISOString()
      const dateEnd = new Date(formData.get('date_end') as string).toISOString()

      assertValidSessionDates(dateStart, dateEnd)

      await createSession({
        department_id: departmentId,
        title: formData.get('title') as string,
        description: formData.get('description')?.toString() || undefined,
        date_start: dateStart,
        date_end: dateEnd,
        location_type: formData.get('location_type') as 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID',
        session_type: (formData.get('session_type') as string) || undefined,
      })

      router.push(`/departments/${departmentId}/sessions`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <Input
        label="Title"
        name="title"
        required
      />

      <Textarea
        label="Description"
        name="description"
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Start Date & Time"
          name="date_start"
          type="datetime-local"
          required
        />
        <Input
          label="End Date & Time"
          name="date_end"
          type="datetime-local"
          required
        />
      </div>

      <Select label="Location Type" name="location_type" required>
        <option value="MS_TEAMS">MS Teams</option>
        <option value="IN_PERSON">In Person</option>
        <option value="HYBRID">Hybrid</option>
      </Select>

      <Select label="Session Type" name="session_type">
        <option value="">General</option>
        {SESSION_TYPES.map((t) => (
          <option key={t} value={t}>{SESSION_TYPE_LABELS[t]}</option>
        ))}
      </Select>

      <div className="flex flex-col sm:flex-row gap-4">
        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
          {loading ? 'Creating...' : 'Create Session'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
