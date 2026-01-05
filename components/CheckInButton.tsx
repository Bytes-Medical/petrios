'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { checkIn } from '@/app/actions/attendance'

interface CheckInButtonProps {
  sessionId: string
}

export function CheckInButton({ sessionId }: CheckInButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCheckIn() {
    setLoading(true)
    setError(null)

    try {
      await checkIn(sessionId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in')
      setLoading(false)
    }
  }

  return (
    <div>
      {error && (
        <div className="p-4 border border-red-500 bg-red-50 mb-4">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}
      <Button onClick={handleCheckIn} disabled={loading}>
        {loading ? 'Checking in...' : 'Check In'}
      </Button>
    </div>
  )
}
