'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Button } from './Button'
import { updateSessionMeetingUrl } from '@/app/actions/sessions'

interface UpdateMeetingUrlFormProps {
  sessionId: string
  currentUrl: string | null
}

export function UpdateMeetingUrlForm({ sessionId, currentUrl }: UpdateMeetingUrlFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    const formData = new FormData(e.currentTarget)
    const url = formData.get('url')?.toString() || null

    try {
      await updateSessionMeetingUrl(sessionId, url || '')
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update meeting URL')
    } finally {
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

      {success && (
        <div className="p-4 border border-green-500 bg-green-50">
          <p className="font-mono text-sm text-green-800">Meeting URL updated successfully!</p>
        </div>
      )}

      <Input
        label="MS Teams Meeting URL"
        name="url"
        type="url"
        defaultValue={currentUrl || ''}
        placeholder="https://teams.microsoft.com/..."
      />

      <div className="flex gap-4">
        <Button type="submit" disabled={loading}>
          {loading ? 'Updating...' : 'Update URL'}
        </Button>
      </div>
    </form>
  )
}
