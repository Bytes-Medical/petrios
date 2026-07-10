'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generatePortfolioPack, saveReflection, type Passport } from '@/app/actions/portfolio'
import { exportTeachingRecord } from '@/app/actions/federation'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { cn } from '@/lib/utils'

interface PortfolioPanelProps {
  passport: Passport
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * The curriculum passport: personal Progress+ coverage, reflections per
 * attended session, and the one-click ARCP portfolio pack download.
 */
export function PortfolioPanel({ passport }: PortfolioPanelProps) {
  const router = useRouter()
  const [periodStart, setPeriodStart] = useState(() => isoDaysAgo(365))
  const [periodEnd, setPeriodEnd] = useState(() => isoDaysAgo(0))
  const [downloading, setDownloading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reflectionBySession = new Map(passport.reflections.map((r) => [r.session_id, r]))
  const attendedEntries = passport.attendance.entries.filter(
    (e) => e.status === 'PRESENT' || e.status === 'LATE'
  )

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      const result = await generatePortfolioPack(
        `${periodStart}T00:00:00.000Z`,
        `${periodEnd}T23:59:59.999Z`
      )
      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${result.base64}`
      link.download = result.filename
      link.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate pack')
    } finally {
      setDownloading(false)
    }
  }

  async function handleExportRecord() {
    setError(null)
    try {
      const result = await exportTeachingRecord()
      const link = document.createElement('a')
      link.href = `data:application/json;charset=utf-8,${encodeURIComponent(result.json)}`
      link.download = result.filename
      link.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export record')
    }
  }

  async function handleSaveReflection(sessionId: string) {
    setSavingId(sessionId)
    setError(null)
    try {
      await saveReflection(sessionId, draft)
      setEditingId(null)
      setDraft('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reflection')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-mono text-xl font-bold">ARCP portfolio pack</h2>
            <p className="font-mono text-sm text-gray-600">
              A verifiable PDF of your attendance, curriculum coverage,
              reflections, and certificates for the chosen period.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="font-mono text-xs">
              From
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 block border border-black px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="font-mono text-xs">
              To
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 block border border-black px-2 py-1.5 font-mono text-sm"
              />
            </label>
            <Button onClick={handleDownload} disabled={downloading}>
              {downloading ? 'Generating…' : 'Download pack'}
            </Button>
            <Button variant="secondary" onClick={handleExportRecord} disabled={downloading}>
              Export record (JSON)
            </Button>
          </div>
        </div>
        {error && <p className="mt-3 font-mono text-xs text-red-700">{error}</p>}
      </Card>

      <Card>
        <h2 className="mb-1 font-mono text-xl font-bold">Curriculum passport</h2>
        <p className="mb-4 font-mono text-sm text-gray-600">
          RCPCH Progress+ domains covered by teaching you attended.
        </p>
        <div className="divide-y divide-gray-200 border border-gray-200">
          {passport.coverage.map((c) => (
            <div
              key={c.code}
              className={cn(
                'flex items-center justify-between px-3 py-2',
                c.sessionCount === 0 && 'bg-red-50'
              )}
            >
              <span className="font-mono text-sm">{c.name}</span>
              <Badge variant={c.sessionCount > 0 ? 'success' : 'danger'}>
                {c.sessionCount > 0 ? `${c.sessionCount} session(s)` : 'gap'}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-mono text-xl font-bold">Reflections</h2>
        <p className="mb-4 font-mono text-sm text-gray-600">
          A short reflection per attended session strengthens the pack as
          ARCP evidence.
        </p>
        {attendedEntries.length === 0 ? (
          <p className="border border-dashed border-gray-300 px-4 py-6 text-center font-mono text-sm text-gray-500">
            Attend a session and your reflection prompts appear here.
          </p>
        ) : (
          <div className="space-y-3">
            {attendedEntries.map((entry) => {
              const reflection = reflectionBySession.get(entry.session_id)
              const editing = editingId === entry.session_id
              return (
                <div key={entry.session_id} className="border border-gray-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-bold">
                        {entry.session_title}
                      </p>
                      <p className="font-mono text-xs text-gray-500">
                        {new Date(entry.session_date).toLocaleDateString('en-GB')}
                        {entry.primary_source === 'RECALL' && ' · caught up'}
                      </p>
                    </div>
                    {!editing && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(entry.session_id)
                          setDraft(reflection?.body ?? '')
                        }}
                        className="shrink-0 font-mono text-xs underline underline-offset-2 hover:text-clay-700"
                      >
                        {reflection ? 'Edit reflection' : 'Add reflection'}
                      </button>
                    )}
                  </div>
                  {!editing && reflection && (
                    <p className="mt-2 whitespace-pre-wrap font-mono text-xs text-gray-700">
                      {reflection.body}
                    </p>
                  )}
                  {editing && (
                    <div className="mt-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        placeholder="What did you learn? What will you do differently?"
                        className="w-full border border-black px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-clay-600"
                      />
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={savingId === entry.session_id || !draft.trim()}
                          onClick={() => handleSaveReflection(entry.session_id)}
                        >
                          {savingId === entry.session_id ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
