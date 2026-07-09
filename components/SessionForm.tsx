'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { DateTimePicker } from './DateTimePicker'
import { Textarea } from './Textarea'
import { Select } from './Select'
import { Button } from './Button'
import { DurationSelect } from './DurationSelect'
import { createSession } from '@/app/actions/sessions'
import { assertValidSessionDates } from '@/lib/session-validation'
import { computeDateEnd } from '@/lib/session-duration'

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
      const dateEnd = computeDateEnd(dateStart, Number(formData.get('duration')))

      assertValidSessionDates(dateStart, dateEnd)

      await createSession({
        department_id: departmentId,
        title: formData.get('title') as string,
        description: formData.get('description')?.toString() || undefined,
        date_start: dateStart,
        date_end: dateEnd,
        location_type: formData.get('location_type') as 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID',
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
        <DateTimePicker
          label="Start Date & Time"
          name="date_start"
          required
        />
        <DurationSelect name="duration" required />
      </div>

      <Select label="Location Type" name="location_type" required>
        <option value="JITSI">Byte Meet (Video)</option>
        <option value="MS_TEAMS">MS Teams</option>
        <option value="IN_PERSON">In Person</option>
        <option value="HYBRID">Hybrid</option>
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
