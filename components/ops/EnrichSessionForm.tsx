'use client'

import { Select } from '../Select'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { enrichSession } from '@/app/actions/ops'
import { Button } from '@/components/Button'

interface EnrichSessionFormProps {
  sessions: { id: string; title: string; date_start: string }[]
  /** Session ids that already have at least one domain mapping. */
  mappedSessionIds: string[]
}

/** Pick a session → AI summary + stored Progress+ mapping. */
export function EnrichSessionForm({ sessions, mappedSessionIds }: EnrichSessionFormProps) {
  const router = useRouter()
  const mapped = new Set(mappedSessionIds)
  const [sessionId, setSessionId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)

  async function handleEnrich() {
    if (!sessionId) return
    setBusy(true)
    setError(null)
    setSummary(null)
    try {
      const result = await enrichSession(sessionId)
      setSummary(result.summary ?? 'No summary produced (AI not configured?)')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrichment failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Select
            aria-label="Session"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
          <option value="">Choose a session…</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title} —{' '}
              {new Date(session.date_start).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
              })}
              {mapped.has(session.id) ? ' (mapped)' : ''}
            </option>
          ))}
          </Select>
        </div>
        <Button onClick={handleEnrich} disabled={!sessionId || busy}>
          {busy ? 'Enriching…' : 'Enrich session'}
        </Button>
      </div>
      {error && <p className="mt-2 font-mono text-xs text-red-700">{error}</p>}
      {summary && (
        <div className="mt-3 border border-black bg-clay-50 p-3">
          <p className="mb-1 font-mono text-xs font-bold uppercase tracking-wider">AI summary</p>
          <p className="whitespace-pre-wrap font-mono text-sm">{summary}</p>
        </div>
      )}
    </div>
  )
}
