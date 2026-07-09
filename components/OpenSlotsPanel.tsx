'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'
import { useToast } from './ToastProvider'
import { claimSlotAsMember } from '@/app/actions/teaching-slots'
import type { ClaimableSlotView } from '@/app/actions/teaching-slots'
import { describeSlot } from '@/lib/slot-schedule'
import { LOCATION_TYPE_LABELS_SHORT } from '@/lib/types'

interface OpenSlotsPanelProps {
  slots: ClaimableSlotView[]
}

/** Open teaching slots this member was invited to claim (first come, first served). */
export function OpenSlotsPanel({ slots }: OpenSlotsPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleClaim(slotId: string) {
    setLoading(true)
    try {
      await claimSlotAsMember(slotId, topic || undefined)
      showToast({
        variant: 'success',
        title: "You're booked to teach",
        description: 'The organiser has been notified and will confirm the topic.',
      })
      setClaimingId(null)
      setTopic('')
      router.refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to claim the slot'
      showToast({ variant: 'error', title: message })
      if (message.includes('just claimed')) {
        setClaimingId(null)
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  if (slots.length === 0) return null

  return (
    <div>
      <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
        Open teaching slots — claim one
      </h3>
      <div className="space-y-3">
        {slots.map((slot) => {
          const desc = describeSlot(slot)
          const isClaiming = claimingId === slot.id
          return (
            <div
              key={slot.id}
              className="border border-black border-l-4 border-l-green-800 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-sm font-bold">{desc.dateStr}</p>
                  <p className="mt-1 font-mono text-xs text-gray-600">
                    {desc.timeRangeStr} · {desc.durationStr} ·{' '}
                    {LOCATION_TYPE_LABELS_SHORT[slot.location_type] || slot.location_type}
                    {slot.department_name ? ` · ${slot.department_name}` : ''}
                  </p>
                </div>
                <Badge variant="success">Open</Badge>
              </div>

              {isClaiming ? (
                <div className="mt-3 space-y-2">
                  <Input
                    label="Suggested topic (optional)"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. Managing acute asthma"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleClaim(slot.id)}
                      disabled={loading}
                    >
                      {loading ? 'Claiming...' : 'Confirm claim'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setClaimingId(null)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setClaimingId(slot.id)
                      setTopic('')
                    }}
                    disabled={loading}
                  >
                    Claim this slot
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
