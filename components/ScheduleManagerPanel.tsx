'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { BulkSlotPicker } from './BulkSlotPicker'
import { PublishSlotsDialog } from './PublishSlotsDialog'
import { useToast } from './ToastProvider'
import { closeTeachingSlot, deleteTeachingSlot } from '@/app/actions/teaching-slots'
import type { DepartmentSlotView } from '@/app/actions/teaching-slots'
import { describeSlot } from '@/lib/slot-schedule'
import {
  LOCATION_TYPE_LABELS_SHORT,
  type ContactGroupWithCount,
  type SlotDisplayStatus,
} from '@/lib/types'

const STATUS_BADGES: Record<SlotDisplayStatus, { label: string; variant: 'success' | 'clay' | 'default' | 'warning' }> = {
  OPEN: { label: 'Open', variant: 'success' },
  CLAIMED: { label: 'Claimed', variant: 'clay' },
  CLOSED: { label: 'Closed', variant: 'default' },
  EXPIRED: { label: 'Expired', variant: 'warning' },
}

interface ScheduleManagerPanelProps {
  departmentId: string
  slots: DepartmentSlotView[]
  groups: ContactGroupWithCount[]
  deptMemberCount: number
  orgMemberCount: number
  busyDayKeys: string[]
}

export function ScheduleManagerPanel({
  departmentId,
  slots,
  groups,
  deptMemberCount,
  orgMemberCount,
  busyDayKeys,
}: ScheduleManagerPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [publishOpen, setPublishOpen] = useState(false)

  const publishable = slots.filter((s) => s.display_status === 'OPEN')

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function runSlotAction(
    kind: 'close' | 'delete',
    slotId: string,
    action: (id: string) => Promise<unknown>
  ) {
    setLoading(`${kind}-${slotId}`)
    try {
      await action(slotId)
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(slotId)
        return next
      })
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: `Failed to ${kind} slot`,
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-1 text-xl font-mono font-bold">Open Teaching Dates</h2>
        <p className="mb-5 font-mono text-sm text-gray-600">
          Pick the dates teaching can happen, set the usual time and length,
          and create the slots in one go. Then publish them below so teachers
          can claim — first come, first served.
        </p>
        <BulkSlotPicker departmentId={departmentId} busyDayKeys={busyDayKeys} />
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-mono font-bold">Slots</h2>
          <Button
            type="button"
            onClick={() => setPublishOpen(true)}
            disabled={selectedIds.size === 0}
          >
            Publish selected ({selectedIds.size})
          </Button>
        </div>

        {slots.length === 0 ? (
          <p className="font-mono text-sm text-gray-500">
            No slots yet — create some above.
          </p>
        ) : (
          <ul className="space-y-2">
            {slots.map((slot) => {
              const badge = STATUS_BADGES[slot.display_status]
              const desc = describeSlot(slot)
              const selectable = slot.display_status === 'OPEN'
              return (
                <li
                  key={slot.id}
                  className="flex flex-wrap items-center justify-between gap-3 border border-gray-300 p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      aria-label="Select slot for publishing"
                      className="h-4 w-4 accent-clay-600"
                      disabled={!selectable}
                      checked={selectedIds.has(slot.id)}
                      onChange={() => toggleSelected(slot.id)}
                    />
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-bold">
                        {desc.dateStr} · {desc.timeRangeStr}
                      </p>
                      <p className="font-mono text-xs text-gray-600">
                        {desc.durationStr} ·{' '}
                        {LOCATION_TYPE_LABELS_SHORT[slot.location_type] ?? slot.location_type}
                        {slot.claimed_name ? ` · Claimed by ${slot.claimed_name}` : ''}
                        {slot.status === 'CLAIMED' && !slot.session_id
                          ? ' · session removed'
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {slot.status === 'CLAIMED' && slot.session_id && (
                      <Link
                        href={`/sessions/${slot.session_id}/manage`}
                        className="font-mono text-xs underline underline-offset-4"
                      >
                        Assign topic →
                      </Link>
                    )}
                    {slot.display_status === 'OPEN' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => runSlotAction('close', slot.id, closeTeachingSlot)}
                        disabled={loading === `close-${slot.id}`}
                      >
                        Close
                      </Button>
                    )}
                    {slot.status !== 'CLAIMED' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => runSlotAction('delete', slot.id, deleteTeachingSlot)}
                        disabled={loading === `delete-${slot.id}`}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {publishable.length === 0 && slots.length > 0 && (
          <p className="mt-3 font-mono text-xs text-gray-500">
            No open future slots to publish right now.
          </p>
        )}
      </Card>

      {publishOpen && (
        <PublishSlotsDialog
          departmentId={departmentId}
          slotIds={Array.from(selectedIds)}
          groups={groups}
          deptMemberCount={deptMemberCount}
          orgMemberCount={orgMemberCount}
          onClose={() => setPublishOpen(false)}
        />
      )}
    </div>
  )
}
