'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { claimSlotByCode } from '@/app/actions/teaching-slots'
import { describeSlot } from '@/lib/slot-schedule'
import { formatTimeHM } from '@/lib/date-picker'
import { LOCATION_TYPE_LABELS, type TeachingSlot } from '@/lib/types'

interface SlotClaimPanelProps {
  code: string
  slots: TeachingSlot[]
  initialFirstName: string
  initialLastName: string
}

export function SlotClaimPanel({
  code,
  slots,
  initialFirstName,
  initialLastName,
}: SlotClaimPanelProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [firstName, setFirstName] = useState(initialFirstName)
  const [lastName, setLastName] = useState(initialLastName)
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<TeachingSlot | null>(null)

  async function handleClaim() {
    if (!selectedId) return
    setLoading(true)
    setError(null)
    try {
      await claimSlotByCode(code, selectedId, firstName, lastName, topic || undefined)
      setClaimed(slots.find((s) => s.id === selectedId) ?? null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to claim the slot'
      setError(message)
      if (message.includes('just claimed')) {
        // Someone beat them to it — refresh so the lost slot disappears.
        router.refresh()
        setSelectedId(null)
      }
      setLoading(false)
    }
  }

  if (claimed) {
    const desc = describeSlot(claimed)
    return (
      <div className="space-y-3 text-center py-4">
        <h2 className="text-xl font-mono font-bold">You&apos;re booked in</h2>
        <p className="font-mono text-sm">
          You&apos;re teaching on{' '}
          <strong>
            {desc.dateStr} at {formatTimeHM(claimed.date_start)}
          </strong>
          .
        </p>
        <p className="font-mono text-sm text-gray-600">
          The organiser has been notified and will confirm the topic and
          session details with you by email.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div>
        <h2 className="font-mono font-bold mb-2">1. Choose a slot</h2>
        <div className="space-y-2">
          {slots.map((slot) => {
            const desc = describeSlot(slot)
            const selected = selectedId === slot.id
            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSelectedId(slot.id)}
                className={`w-full text-left border p-3 transition-colors ${
                  selected
                    ? 'border-black bg-black text-white'
                    : 'border-black bg-white hover:bg-gray-50'
                }`}
              >
                <p className="font-mono text-sm font-bold">{desc.dateStr}</p>
                <p className={`font-mono text-xs ${selected ? 'text-gray-200' : 'text-gray-600'}`}>
                  {desc.timeRangeStr} · {desc.durationStr} ·{' '}
                  {LOCATION_TYPE_LABELS[slot.location_type] ?? slot.location_type}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <h2 className="font-mono font-bold mb-2">2. Your details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
          <Input
            label="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="mt-3">
          <Input
            label="Suggested topic (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Managing acute asthma"
          />
        </div>
      </div>

      <Button
        type="button"
        onClick={handleClaim}
        disabled={!selectedId || !firstName.trim() || !lastName.trim() || loading}
        className="w-full sm:w-auto"
      >
        {loading ? 'Claiming...' : 'Claim this slot'}
      </Button>
    </div>
  )
}
