'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { updateSessionStatus } from '@/app/actions/sessions'
import type { SessionStatus } from '@/lib/types'

interface PublishSessionPanelProps {
  sessionId: string
  currentStatus: SessionStatus
}

export function PublishSessionPanel({ sessionId, currentStatus }: PublishSessionPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleStatusChange(newStatus: SessionStatus) {
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      await updateSessionStatus(sessionId, newStatus)
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 border border-green-500 bg-green-50">
          <p className="font-mono text-sm text-green-800">Status updated successfully!</p>
        </div>
      )}

      <div>
        <p className="font-mono text-sm mb-4">
          Current status: <strong>{currentStatus}</strong>
        </p>
        <p className="font-mono text-sm text-gray-600 mb-4">
          Published sessions are visible to all department members. Draft sessions are only visible to moderators.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => handleStatusChange('PUBLISHED')}
          disabled={loading || currentStatus === 'PUBLISHED'}
        >
          {loading ? 'Updating...' : 'Publish Session'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleStatusChange('DRAFT')}
          disabled={loading || currentStatus === 'DRAFT'}
        >
          {loading ? 'Updating...' : 'Unpublish (Draft)'}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => handleStatusChange('CANCELLED')}
          disabled={loading || currentStatus === 'CANCELLED'}
        >
          {loading ? 'Updating...' : 'Cancel Session'}
        </Button>
      </div>
    </div>
  )
}
