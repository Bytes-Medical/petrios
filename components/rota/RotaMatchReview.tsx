'use client'

import { useMemo } from 'react'
import { Button } from '@/components/Button'
import { normaliseName } from '@/lib/rota/identity-normalise'
import type { ExtractedRotaPerson } from '@/lib/rota/mapping'
import type { RotaMatchPreview, RotaPersonLink } from '@/lib/rota/types'

/**
 * Step 5 of the rota upload: who in the file is who in Petrios (O1).
 *
 * Order: existing link (staff number, then email) → exact email → a
 * moderator's confirmation. The server check runs once per upload. Names
 * are compared HERE, against the roster a moderator can already see, and
 * never leave the browser; nothing is pre-ticked, and a name confirmation is
 * asked for again on every upload. Uploaders (coordinators) never see the
 * roster: they get matched / not matched only. Rows that stay unmatched are
 * dropped before anything is sent.
 */

export type RotaConfirmations = Record<string, RotaPersonLink>

export function RotaMatchReview({
  role,
  people,
  preview,
  roster,
  confirmations,
  onConfirm,
  onCheck,
  checking,
}: {
  role: 'MODERATOR' | 'UPLOADER'
  people: ExtractedRotaPerson[]
  preview: RotaMatchPreview | null
  roster: { userId: string; displayName: string; email: string }[] | null
  confirmations: RotaConfirmations
  onConfirm: (ref: string, link: RotaPersonLink | null) => void
  onCheck: () => void
  checking: boolean
}) {
  const rosterByEmail = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }>()
    for (const r of roster ?? []) if (r.email) map.set(r.email.trim().toLowerCase(), r)
    return map
  }, [roster])
  const rosterByName = useMemo(() => {
    const map = new Map<string, { userId: string; displayName: string }[]>()
    for (const r of roster ?? []) {
      const key = normaliseName(r.displayName)
      if (!key) continue
      map.set(key, [...(map.get(key) ?? []), r])
    }
    return map
  }, [roster])

  if (!preview) {
    return (
      <div className="space-y-3">
        <p className="font-mono text-sm text-gray-600">
          Check which rows match trainees in this department. The staff number or email of each row is checked once
          and not stored. This can be done once per upload.
          {role === 'UPLOADER' ? ' You will see matched or not matched only.' : ''}
        </p>
        <Button onClick={onCheck} pending={checking} disabled={people.length === 0}>
          Check matches ({people.length} rows)
        </Button>
      </div>
    )
  }

  if (preview.role === 'UPLOADER') {
    const matched = preview.rows.filter((r) => r.matched).length
    const unmatchedRefs = new Set(preview.rows.filter((r) => !r.matched).map((r) => r.ref))
    const unmatchedPeople = people.filter((p) => unmatchedRefs.has(p.ref))
    return (
      <div className="space-y-3 font-mono text-sm">
        <p>
          <strong>{matched}</strong> rows matched. <strong>{unmatchedPeople.length}</strong> rota rows not matched; they
          will not be sent.
        </p>
        {unmatchedPeople.length > 0 ? (
          <details className="border border-black p-3">
            <summary className="cursor-pointer">Rows not matched (from your file)</summary>
            <ul className="mt-2 list-disc pl-5 text-xs">
              {unmatchedPeople.map((p) => (
                <li key={p.ref}>{p.name ?? p.staffKey ?? p.email ?? p.ref}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-600">
              Most of these are usually not trainees in this department, which is expected. Tell a department moderator
              only about trainees you expected to match (for example new starters): they can link them by staff number
              on this department&apos;s rota page. Linking is never automatic.
            </p>
          </details>
        ) : null}
      </div>
    )
  }

  const byRef = new Map(preview.rows.map((r) => [r.ref, r]))
  const emailMatchedWithKey = people.filter((p) => {
    const row = byRef.get(p.ref)
    return row?.via === 'EMAIL' && row.userId && p.staffKey
  })
  const allEmailLinked = emailMatchedWithKey.every((p) => confirmations[p.ref]?.origin === 'EMAIL_MATCH')
  const sortedRoster = [...(roster ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName))

  function linkAllEmailMatches(on: boolean) {
    for (const p of emailMatchedWithKey) {
      const userId = byRef.get(p.ref)?.userId
      if (userId) onConfirm(p.ref, on ? { user_id: userId, origin: 'EMAIL_MATCH' } : null)
    }
  }

  return (
    <div className="space-y-4">
      {emailMatchedWithKey.length > 0 ? (
        <label className="flex items-start gap-2 border border-black p-3 font-mono text-sm">
          <input type="checkbox" className="mt-1" checked={allEmailLinked} onChange={(e) => linkAllEmailMatches(e.target.checked)} />
          <span>
            Save the {emailMatchedWithKey.length} exact email match{emailMatchedWithKey.length === 1 ? '' : 'es'} as staff-number
            links, so next week they match by staff number.
          </span>
        </label>
      ) : null}
      <div className="overflow-x-auto border border-black">
        <table className="min-w-full font-mono text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="border-b border-black px-2 py-2 text-left">Row in file</th>
              <th className="border-b border-black px-2 py-2 text-left">Match</th>
              <th className="border-b border-black px-2 py-2 text-left">Confirm</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const row = byRef.get(p.ref)
              const confirmed = confirmations[p.ref]
              const label = p.name ?? p.staffKey ?? p.email ?? p.ref
              if (row?.userId) {
                return (
                  <tr key={p.ref}>
                    <td className="px-2 py-1">{label}</td>
                    <td className="px-2 py-1">
                      {row.displayName ?? 'Trainee'} <span className="text-gray-500">({row.via === 'LINK' ? 'linked' : 'same email'})</span>
                    </td>
                    <td className="px-2 py-1 text-gray-500">{confirmed ? 'Will be linked' : '—'}</td>
                  </tr>
                )
              }
              const emailSuggestion = p.email ? rosterByEmail.get(p.email) : undefined
              const nameSuggestions = p.name ? rosterByName.get(normaliseName(p.name)) ?? [] : []
              const suggestion = emailSuggestion ?? (nameSuggestions.length === 1 ? nameSuggestions[0] : undefined)
              const reason = emailSuggestion ? 'same email' : 'same name'
              return (
                <tr key={p.ref} className={confirmed ? '' : 'bg-gray-50'}>
                  <td className="px-2 py-1">{label}</td>
                  <td className="px-2 py-1">
                    {suggestion ? (
                      <span>
                        Suggested: {suggestion.displayName} <span className="text-gray-500">({reason})</span>
                      </span>
                    ) : (
                      <span className="text-gray-500">Not matched</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      aria-label={`Confirm who row ${label} is`}
                      className="w-full border border-black bg-white px-2 py-1"
                      value={confirmed?.user_id ?? ''}
                      onChange={(e) =>
                        onConfirm(
                          p.ref,
                          e.target.value
                            ? {
                                user_id: e.target.value,
                                origin: emailSuggestion && emailSuggestion.userId === e.target.value ? 'EMAIL_MATCH' : 'MODERATOR',
                              }
                            : null
                        )
                      }
                    >
                      <option value="">Do not send</option>
                      {suggestion ? <option value={suggestion.userId}>Confirm: {suggestion.displayName}</option> : null}
                      {sortedRoster
                        .filter((r) => r.userId !== suggestion?.userId)
                        .map((r) => (
                          <option key={r.userId} value={r.userId}>
                            {r.displayName}
                          </option>
                        ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="font-mono text-xs text-gray-600">
        Confirmed rows with a staff number or email are saved as links. Rows with a name only are sent for this upload
        and must be confirmed again next time. Unconfirmed rows are not sent.
      </p>
    </div>
  )
}
