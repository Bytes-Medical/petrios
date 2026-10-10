'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { useToast } from '@/components/ToastProvider'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { revokeRotaLink } from '@/app/actions/rota-identity'
import type { RotaLinkedStaffRow } from '@/lib/rota/types'

/**
 * "Linked staff": which current trainees have a confirmed rota identity link.
 * Shows the kind of key and when it was confirmed, never the staff number,
 * email or hash. Revoking means the next upload simply does not match them.
 */
export function RotaLinkedStaffPanel({
  departmentId,
  rows,
  timeZone,
}: {
  departmentId: string
  rows: RotaLinkedStaffRow[]
  timeZone: string
}) {
  const { showToast } = useToast()
  const { isPending, pendingKey, run } = useActionWithRefresh()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = rows.filter((row) => !hidden.has(row.id))
  const format = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone })

  function revoke(linkId: string) {
    run(async () => {
      const result = await revokeRotaLink(departmentId, linkId)
      if (!result.ok) {
        showToast({ variant: 'error', title: 'Could not revoke the link', description: result.message })
        throw new Error('revoke failed')
      }
      setHidden((current) => new Set(current).add(linkId))
      showToast({ variant: 'success', title: 'Link revoked' })
    }, linkId)
  }

  if (visible.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No trainees are linked yet. Links are created when you confirm a row during an upload, or with the form below.</p>
  }

  return (
    <div className="overflow-x-auto border border-black">
      <table className="min-w-full font-mono text-xs">
        <thead className="bg-gray-50">
          <tr>
            <th className="border-b border-black px-2 py-2 text-left">Trainee</th>
            <th className="border-b border-black px-2 py-2 text-left">Matched by</th>
            <th className="border-b border-black px-2 py-2 text-left">How</th>
            <th className="border-b border-black px-2 py-2 text-left">Confirmed</th>
            <th className="border-b border-black px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.id}>
              <td className="px-2 py-1">{row.displayName}</td>
              <td className="px-2 py-1">{row.keyType === 'STAFF_ID' ? 'Staff number' : 'Email'}</td>
              <td className="px-2 py-1">{row.origin === 'EMAIL_MATCH' ? 'Exact email, confirmed' : 'Moderator confirmed'}</td>
              <td className="px-2 py-1">{format.format(new Date(row.confirmedAt))}</td>
              <td className="px-2 py-1 text-right">
                <Button
                  size="sm"
                  variant="danger"
                  pending={isPending && pendingKey === row.id}
                  disabled={isPending}
                  aria-label={`Revoke the ${row.keyType === 'STAFF_ID' ? 'staff number' : 'email'} link for ${row.displayName}`}
                  onClick={() => revoke(row.id)}
                >
                  Revoke
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
