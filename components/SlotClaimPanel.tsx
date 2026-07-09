'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { claimSlotByCode } from '@/app/actions/teaching-slots'
import { formatDayKey } from '@/lib/date-picker'
import { exactDurationFromDates, formatDuration } from '@/lib/session-duration'
import type { TeachingSlot } from '@/lib/types'

const LOCATION_LABELS: Record<string, string> = {
  MS_TEAMS: 'Microsoft Teams (Online)',
  IN_PERSON: 'In Person',
  HYBRID: 'Hybrid (In Person + Online)',
}

interface SlotClaimPanelProps {
  code: string
  slots: TeachingSlot[]
  initialFirstName: string
  initialLastName: string
}

function slotDayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
    const start = new Date(claimed.date_start)
    return (
      <div className="space-y-3 text-center py-4">
        <h2 className="text-xl font-mono font-bold">You&apos;re booked in</h2>
        <p className="font-mono text-sm">
          You&apos;re teaching on{' '}
          <strong>
            {formatDayKey(slotDayKey(claimed.date_start))} at{' '}
            {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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
            const start = new Date(slot.date_start)
            const end = new Date(slot.date_end)
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
                <p className="font-mono text-sm font-bold">
                  {formatDayKey(slotDayKey(slot.date_start))}
                </p>
                <p className={`font-mono text-xs ${selected ? 'text-gray-200' : 'text-gray-600'}`}>
                  {start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}–
                  {end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ·{' '}
                  {formatDuration(exactDurationFromDates(slot.date_start, slot.date_end))} ·{' '}
                  {LOCATION_LABELS[slot.location_type] ?? slot.location_type}
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
