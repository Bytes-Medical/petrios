'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/Button'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { confirmRotaSuggestion, dismissRotaSuggestion } from '@/app/actions/rota-attendance'
import type { RotaSuggestionRow, RotaSuggestionsView } from '@/lib/rota/types'

/**
 * The "Expected roster" panel on Manage → Attendance (spec/14, spec/03).
 * Lists trainees with no valid presence evidence; a rota flag shows as a
 * suggestion the moderator confirms or dismisses one person at a time.
 * There is no bulk action and nothing is pre-selected. Moderators only ever
 * see "rostered unavailable": never a reason or leave type.
 */
export function RotaSuggestionsPanel({ view }: { view: RotaSuggestionsView }) {
  const { isPending, pendingKey, run } = useActionWithRefresh()
  const [error, setError] = useState<string | null>(null)
  const suggestions = view.rows.filter((row) => row.state === 'SUGGESTED').length

  function act(row: RotaSuggestionRow, kind: 'confirm' | 'dismiss') {
    const question =
      kind === 'confirm'
        ? `Record ${row.displayName} as excused (rostered unavailable)? This writes a moderator decision for this session.`
        : `Dismiss the rota suggestion for ${row.displayName}? This cannot be undone: the rota will not be offered for them in this session, and without a check-in or your own decision they are recorded as absent at finalization.`
    if (!window.confirm(question)) return
    setError(null)
    run(async () => {
      const result =
        kind === 'confirm'
          ? await confirmRotaSuggestion(view.sessionId, row.userId)
          : await dismissRotaSuggestion(view.sessionId, row.userId)
      if (!result.ok) setError(result.message)
    }, `${kind}:${row.userId}`)
  }

  return (
    <div className="space-y-4 font-mono text-sm">
      <p className="text-gray-600">
        Trainees in this department with no attendance evidence yet.
        {suggestions > 0
          ? ' Rota suggestions are only suggestions: confirm or dismiss each one yourself.'
          : ''}{' '}
        Finalizing attendance works as usual and is never blocked by the rota.
      </p>

      {view.showAsWorkedBanner && (
        <p className="border border-gray-400 bg-gray-50 px-3 py-2 text-gray-800">
          Suggestions for this session come from the planned rota. The next weekly as-worked upload may change them;
          you do not need to wait for it to finalize.{' '}
          <Link href={`/departments/${view.departmentId}/rota`} className="underline">
            Rota upload
          </Link>
        </p>
      )}

      {suggestions > 0 && !view.readOnlyUntilEnd && (
        <p className="text-gray-600">
          {suggestions} suggestion{suggestions === 1 ? ' is' : 's are'} still undecided. Finalizing records undecided
          trainees as absent.
        </p>
      )}

      {error && (
        <p role="alert" className="border border-red-500 bg-red-50 px-3 py-2 text-red-800">
          {error}
        </p>
      )}

      {view.rows.length === 0 ? (
        <p className="text-gray-600">Every trainee in this department has attendance evidence.</p>
      ) : (
        <ul className="divide-y divide-gray-300 border border-black">
          {view.rows.map((row) => (
            <li key={row.userId} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-bold">{row.displayName}</p>
                <p className="break-words text-gray-700">{describeRow(row)}</p>
                <Markers row={row} />
              </div>
              {row.state === 'SUGGESTED' && (
                <div className="flex shrink-0 flex-col gap-1 sm:items-end">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => act(row, 'confirm')}
                      disabled={!row.canConfirm || isPending}
                      pending={pendingKey === `confirm:${row.userId}`}
                      aria-label={`Confirm excusal for ${row.displayName}`}
                      aria-describedby={row.canConfirm ? undefined : `rota-confirm-hint-${row.userId}`}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => act(row, 'dismiss')}
                      disabled={!row.canDismiss || isPending}
                      pending={pendingKey === `dismiss:${row.userId}`}
                      aria-label={`Dismiss rota suggestion for ${row.displayName}`}
                    >
                      Dismiss
                    </Button>
                  </div>
                  {!row.canConfirm ? (
                    <p id={`rota-confirm-hint-${row.userId}`} className="text-xs text-gray-600">
                      Confirm opens after the session ends.
                    </p>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function rotaAsOf(row: RotaSuggestionRow): string {
  if (!row.asOf) return ''
  const kind = row.kind === 'WORKED' ? 'as worked' : 'planned'
  return ` · rota as of ${row.asOf} (${kind})`
}

function describeRow(row: RotaSuggestionRow): string {
  switch (row.state) {
    case 'SUGGESTED':
      return `Suggested: excused (rostered unavailable)${rotaAsOf(row)}`
    case 'CONFIRMED':
      return `Excused (rostered unavailable), confirmed${rotaAsOf(row)}`
    case 'DISMISSED':
      return `Rota suggestion dismissed${rotaAsOf(row)}`
    case 'CONTESTED':
      return 'No suggestion: decide manually.'
    case 'DECIDED_MANUALLY':
      return 'A moderator decision is recorded.'
    default:
      return 'No attendance evidence yet.'
  }
}

function Markers({ row }: { row: RotaSuggestionRow }) {
  const markers = [
    row.markers.contested ? 'Contested by trainee' : null,
    row.markers.rotaChanged ? 'Rota changed since you confirmed' : null,
    row.markers.evidenceAfterExcusal ? 'Attendance evidence received after excusal' : null,
  ].filter((marker): marker is string => marker !== null)
  if (markers.length === 0) return null
  return (
    <p className="mt-1 flex flex-wrap gap-2">
      {markers.map((marker) => (
        <span key={marker} className="border border-amber-700 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
          {marker}
        </span>
      ))}
    </p>
  )
}
