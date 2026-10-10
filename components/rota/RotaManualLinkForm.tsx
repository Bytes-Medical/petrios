'use client'

import { useState } from 'react'
import { Button } from '@/components/Button'
import { Input } from '@/components/Input'
import { Select } from '@/components/Select'
import { useToast } from '@/components/ToastProvider'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { linkRotaIdentity } from '@/app/actions/rota-identity'

/**
 * "Link by staff number" (spec/14): a moderator links one current trainee to
 * the staff number (ESR assignment or local number) and/or email the rota
 * uses for them, typically new starters after a changeover, so the rota
 * export never has to be passed to the moderator. Petrios keeps only a keyed
 * hash; the number and email are not stored. Trainees cannot link themselves.
 */
export function RotaManualLinkForm({
  departmentId,
  roster,
}: {
  departmentId: string
  roster: { userId: string; displayName: string }[]
}) {
  const { showToast } = useToast()
  const { isPending, run } = useActionWithRefresh()
  const [userId, setUserId] = useState('')
  const [staffNumber, setStaffNumber] = useState('')
  const [email, setEmail] = useState('')
  const [stripSuffix, setStripSuffix] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sorted = [...roster].sort((a, b) => a.displayName.localeCompare(b.displayName))

  function submit() {
    setError(null)
    run(async () => {
      const result = await linkRotaIdentity({
        departmentId,
        userId,
        staffNumber: staffNumber || undefined,
        email: email || undefined,
        stripAssignmentSuffix: stripSuffix,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setStaffNumber('')
      setEmail('')
      showToast({
        variant: 'success',
        title: 'Trainee linked',
        description: result.data.refused > 0 ? 'One identifier was already linked to another department and was not changed.' : undefined,
      })
    }, 'link')
  }

  return (
    <div className="space-y-3 font-mono text-sm">
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Link a trainee by staff number</h3>
      <p className="text-xs leading-5 text-gray-600">
        For trainees the upload did not match (for example new starters after a changeover). Enter the number exactly
        as the rota export shows it, or the email the rota uses. Only a keyed code is kept, never the number or email.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Trainee" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose a trainee…</option>
          {sorted.map((t) => (
            <option key={t.userId} value={t.userId}>
              {t.displayName}
            </option>
          ))}
        </Select>
        <Input
          label="Staff number (ESR assignment or local)"
          value={staffNumber}
          maxLength={64}
          autoComplete="off"
          onChange={(e) => setStaffNumber(e.target.value)}
        />
        <Input
          label="Email in the rota (optional)"
          type="email"
          value={email}
          maxLength={254}
          autoComplete="off"
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="flex items-start gap-2 self-end text-xs">
          <input type="checkbox" className="mt-0.5" checked={stripSuffix} onChange={(e) => setStripSuffix(e.target.checked)} />
          <span>Remove an assignment suffix such as -1 (tick this only if your upload profile does the same)</span>
        </label>
      </div>
      {error ? (
        <p role="alert" className="border border-red-500 bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      ) : null}
      <Button size="sm" onClick={submit} pending={isPending} disabled={!userId || (!staffNumber.trim() && !email.trim())}>
        Link trainee
      </Button>
    </div>
  )
}
