'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { DateTimePicker } from './DateTimePicker'
import { Textarea } from './Textarea'
import { Select } from './Select'
import { Button } from './Button'
import { updateSession } from '@/app/actions/sessions'
import { assertValidSessionDates } from '@/lib/session-validation'
import type { Session } from '@/lib/types'

interface EditSessionFormProps {
  session: Session
  onCancel: () => void
  onSave: () => void
}

export function EditSessionForm({ session, onCancel, onSave }: EditSessionFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const formData = new FormData(e.currentTarget)

    try {
      const capacityVal = formData.get('capacity')?.toString()
      const dateStart = new Date(formData.get('date_start') as string).toISOString()
      const dateEnd = new Date(formData.get('date_end') as string).toISOString()

      assertValidSessionDates(dateStart, dateEnd)

      await updateSession(session.id, {
        title: formData.get('title') as string,
        description: formData.get('description')?.toString() || null,
        date_start: dateStart,
        date_end: dateEnd,
        location_type: formData.get('location_type') as 'MS_TEAMS' | 'IN_PERSON' | 'HYBRID',
        capacity: capacityVal ? parseInt(capacityVal, 10) : null,
      })

      router.refresh()
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update session')
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
        defaultValue={session.title}
        required
      />

      <Textarea
        label="Description"
        name="description"
        defaultValue={session.description || ''}
        rows={4}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DateTimePicker
          label="Start Date & Time"
          name="date_start"
          defaultValue={session.date_start}
          required
        />
        <DateTimePicker
          label="End Date & Time"
          name="date_end"
          defaultValue={session.date_end}
          required
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select label="Location Type" name="location_type" defaultValue={session.location_type} required>
          <option value="MS_TEAMS">MS Teams</option>
          <option value="IN_PERSON">In Person</option>
          <option value="HYBRID">Hybrid</option>
        </Select>

        <Input
          label="Capacity"
          name="capacity"
          type="number"
          min={1}
          defaultValue={session.capacity ?? ''}
          placeholder="No limit"
        />
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Button type="submit" disabled={loading} className="w-full sm:w-auto">
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
