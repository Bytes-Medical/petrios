'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { useToast } from './ToastProvider'
import { publishSlots } from '@/app/actions/teaching-slots'
import type { ContactGroupWithCount } from '@/lib/types'

interface PublishSlotsDialogProps {
  departmentId: string
  slotIds: string[]
  groups: ContactGroupWithCount[]
  deptMemberCount: number
  orgMemberCount: number
  onClose: () => void
}

export function PublishSlotsDialog({
  departmentId,
  slotIds,
  groups,
  deptMemberCount,
  orgMemberCount,
  onClose,
}: PublishSlotsDialogProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [allDept, setAllDept] = useState(false)
  const [allOrg, setAllOrg] = useState(false)
  const [loading, setLoading] = useState(false)

  const hasAudience = selectedGroups.size > 0 || allDept || allOrg

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handlePublish() {
    setLoading(true)
    try {
      const result = await publishSlots(departmentId, {
        slotIds,
        groupIds: Array.from(selectedGroups),
        allDepartmentMembers: allDept,
        allOrgMembers: allOrg,
      })
      showToast({
        variant: result.failed > 0 ? 'info' : 'success',
        title: `Invites sent to ${result.emailed} of ${result.recipients} recipient${result.recipients === 1 ? '' : 's'}`,
        description:
          result.failed > 0 ? `${result.failed} email(s) failed — see server logs.` : undefined,
      })
      onClose()
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to publish slots',
        description: err instanceof Error ? err.message : undefined,
      })
      setLoading(false)
    }
  }

  const checkboxRow =
    'flex items-center gap-3 border border-gray-300 px-3 py-2.5 font-mono text-sm cursor-pointer hover:bg-gray-50'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border-2 border-black bg-white p-5 shadow-[8px_8px_0_rgba(31,29,26,0.4)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-mono text-lg font-bold">
          Publish {slotIds.length} slot{slotIds.length === 1 ? '' : 's'}
        </h2>
        <p className="mt-1 mb-4 font-mono text-xs text-gray-600">
          Everyone selected gets an email listing the open slots. External
          contacts get a personal claim link; registered members claim from
          their dashboard. First come, first served.
        </p>

        <div className="space-y-2">
          {groups.map((group) => (
            <label key={group.id} className={checkboxRow}>
              <input
                type="checkbox"
                checked={selectedGroups.has(group.id)}
                onChange={() => toggleGroup(group.id)}
                className="h-4 w-4 accent-clay-600"
              />
              <span>
                {group.name}{' '}
                <span className="text-gray-500">({group.member_count})</span>
              </span>
            </label>
          ))}
          {groups.length === 0 && (
            <p className="font-mono text-xs text-gray-500">
              No contact groups yet — create them in Settings → Address Book.
            </p>
          )}

          <label className={checkboxRow}>
            <input
              type="checkbox"
              checked={allDept}
              onChange={() => setAllDept((v) => !v)}
              className="h-4 w-4 accent-clay-600"
            />
            <span>
              All registered department members{' '}
              <span className="text-gray-500">({deptMemberCount})</span>
            </span>
          </label>

          <label className={checkboxRow}>
            <input
              type="checkbox"
              checked={allOrg}
              onChange={() => setAllOrg((v) => !v)}
              className="h-4 w-4 accent-clay-600"
            />
            <span>
              All registered organisation members{' '}
              <span className="text-gray-500">({orgMemberCount})</span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex gap-3">
          <Button type="button" onClick={handlePublish} disabled={!hasAudience || loading}>
            {loading ? 'Publishing...' : 'Publish & send invites'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
