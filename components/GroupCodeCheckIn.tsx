'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Button } from './Button'
import { checkIn } from '@/app/actions/attendance'

interface GroupCodeCheckInProps {
  sessionId: string
  groupCodeVersion?: number | null
}

export function GroupCodeCheckIn({ sessionId, groupCodeVersion }: GroupCodeCheckInProps) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleGroupCodeCheckIn(e: React.FormEvent) {
    e.preventDefault()
    if (!code || code.length !== 6) {
      setError('Please enter a 6-character code')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await checkIn(sessionId, code.toUpperCase(), groupCodeVersion || undefined)
      setCode('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in with group code')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleGroupCodeCheckIn} className="space-y-3">
      {error && (
        <div className="p-3 border border-red-500 bg-red-50">
          <p className="font-mono text-xs text-red-800">{error}</p>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          label="Group Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter code"
          className="flex-1"
          maxLength={6}
        />
        <Button type="submit" disabled={loading || !code} className="mt-6">
          {loading ? 'Checking in...' : 'Check In'}
        </Button>
      </div>
    </form>
  )
}
