import type { RotaUploadSummary as Summary } from '@/lib/rota/types'

/**
 * Result of one upload (both batches). Counts only. The number of people the
 * rota showed as unavailable is deliberately not shown: "sessions checked"
 * counts sessions, not people. Link counts appear for moderators only; a
 * coordinator's result never carries them (spec/14).
 */
export function RotaUploadSummary({
  results,
  droppedInBrowser,
}: {
  results: { kind: 'WORKED' | 'PLANNED'; summary: Summary }[]
  droppedInBrowser: number
}) {
  const serverUnmatched = results.reduce((max, r) => Math.max(max, r.summary.unmatched), 0)
  const notMatched = droppedInBrowser + serverUnmatched
  const newUnmatched = results.find((r) => r.summary.newUnmatchedSinceLast !== null)?.summary.newUnmatchedSinceLast ?? null
  return (
    <div className="space-y-4 font-mono text-sm">
      <p>
        <strong>{notMatched}</strong> rota row{notMatched === 1 ? '' : 's'} not matched.
        {newUnmatched !== null && newUnmatched > 0 ? ` ${newUnmatched} new unmatched since the last upload.` : ''}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {results.map(({ kind, summary }) => (
          <div key={kind} className="border border-black p-4">
            <h4 className="mb-2 font-bold">{kind === 'WORKED' ? 'As worked (past days)' : 'Planned (today onwards)'}</h4>
            {summary.replayed ? <p className="mb-2 text-xs text-gray-600">Already received; nothing changed.</p> : null}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt>Rows sent</dt>
              <dd className="text-right">{summary.peopleReceived}</dd>
              <dt>Matched</dt>
              <dd className="text-right">{summary.matched}</dd>
              <dt>Not matched</dt>
              <dd className="text-right">{summary.unmatched}</dd>
              <dt>Conflicts</dt>
              <dd className="text-right">{summary.conflicts}</dd>
              <dt>Sessions checked</dt>
              <dd className="text-right">{summary.sessionsAnnotated}</dd>
              {summary.details ? (
                <>
                  <dt>Links saved</dt>
                  <dd className="text-right">{summary.details.linksUpserted}</dd>
                </>
              ) : null}
              {summary.details && summary.details.linksRefused > 0 ? (
                <>
                  <dt>Links refused</dt>
                  <dd className="text-right">{summary.details.linksRefused}</dd>
                </>
              ) : null}
            </dl>
          </div>
        ))}
      </div>
      {results.some((r) => r.summary.conflicts > 0) ? (
        <p className="text-xs text-gray-600">
          A conflict means a row&apos;s staff number and email point to different people, or two rows point to the same
          person. Those rows were not used.
        </p>
      ) : null}
    </div>
  )
}
