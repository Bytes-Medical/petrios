'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { useToast } from '@/components/ToastProvider'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { grantRotaUploader, revokeRotaUploader } from '@/app/actions/rota-admin'
import type { RotaAdminState } from '@/lib/rota/types'

/**
 * Rota uploader grants (O6): the narrow role a rota coordinator needs to
 * upload a department's rota. Uploaders see matched / not matched only,
 * never the roster or anyone's flags. A trainee of the department cannot be
 * granted it. In cleanup-only mode only Remove is offered.
 */
export function RotaUploadersPanel({ state, timeZone }: { state: RotaAdminState; timeZone: string }) {
  const { showToast } = useToast()
  const { isPending, pendingKey, run } = useActionWithRefresh()
  const [emails, setEmails] = useState<Record<string, string>>({})
  const enrolled = state.departments.filter((d) => d.enrolled)
  const format = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone })

  function act(key: string, fn: () => Promise<{ ok: boolean; message?: string }>, success: string, after?: () => void) {
    run(async () => {
      const result = await fn()
      if (!result.ok) {
        showToast({ variant: 'error', title: 'Not saved', description: 'message' in result ? result.message : undefined })
        throw new Error('rota uploader action failed')
      }
      after?.()
      showToast({ variant: 'success', title: success })
    }, key)
  }

  if (enrolled.length === 0) {
    return <p className="font-mono text-sm text-gray-600">Enrol a department first.</p>
  }

  return (
    <div className="space-y-5 font-mono text-sm">
      {enrolled.map((d) => {
        const uploaders = state.uploaders.filter((u) => u.departmentId === d.id)
        return (
          <div key={d.id} className="border border-black p-3">
            <h4 className="mb-2 font-bold">{d.name}</h4>
            {uploaders.length === 0 ? <p className="mb-2 text-xs text-gray-600">No rota uploaders.</p> : null}
            <ul className="mb-3 space-y-1">
              {uploaders.map((u) => (
                <li key={u.userId} className="flex items-center justify-between gap-3 text-xs">
                  <span>
                    {u.displayName} <span className="text-gray-500">since {format.format(new Date(u.grantedAt))}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    pending={isPending && pendingKey === `revoke-${d.id}-${u.userId}`}
                    disabled={isPending}
                    aria-label={`Remove ${u.displayName} as rota uploader for ${d.name}`}
                    onClick={() => act(`revoke-${d.id}-${u.userId}`, () => revokeRotaUploader(d.id, u.userId), 'Uploader removed')}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            {state.cleanupOnly ? null : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 flex-1 sm:min-w-[16rem]">
                  <Input
                    label="Organisation member's email"
                    type="email"
                    value={emails[d.id] ?? ''}
                    onChange={(e) => setEmails((current) => ({ ...current, [d.id]: e.target.value }))}
                  />
                </div>
                <Button
                  size="sm"
                  pending={isPending && pendingKey === `grant-${d.id}`}
                  disabled={isPending || !(emails[d.id] ?? '').trim()}
                  onClick={() =>
                    act(`grant-${d.id}`, () => grantRotaUploader(d.id, emails[d.id] ?? ''), 'Uploader added', () =>
                      setEmails((current) => ({ ...current, [d.id]: '' }))
                    )
                  }
                >
                  Add uploader
                </Button>
              </div>
            )}
            {state.cleanupOnly ? null : (
              <p className="mt-2 text-xs leading-5 text-gray-600">
                The uploader must already be a member of this organisation and must not be a trainee of this
                department. Uploaders see matched / not matched only.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
