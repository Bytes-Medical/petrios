'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { deleteSession } from '@/app/actions/sessions'

interface DeleteSessionButtonProps {
  sessionId: string
}

export function DeleteSessionButton({ sessionId }: DeleteSessionButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    if (!confirm('Delete this session?')) return
    setLoading(true)
    setError(null)
    try {
      await deleteSession(sessionId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="danger" onClick={handleDelete} disabled={loading}>
        {loading ? 'Deleting...' : 'Delete'}
      </Button>
      {error && <span className="font-mono text-xs text-red-600">{error}</span>}
    </div>
  )
}
