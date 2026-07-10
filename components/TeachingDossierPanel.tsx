'use client'

import { useState } from 'react'
import { downloadTeachingDossier } from '@/app/actions/portfolio'
import { Button } from './Button'
import { Card } from './Card'

/**
 * Appraisal/revalidation evidence for teachers: pick a period, download the
 * teaching activity dossier. Shown in the dashboard Teaching tab for anyone
 * who has taught.
 */
export function TeachingDossierPanel({ hasTaught }: { hasTaught: boolean }) {
  const [periodStart, setPeriodStart] = useState(() =>
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  )
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10))
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!hasTaught) return null

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      const result = await downloadTeachingDossier(
        `${periodStart}T00:00:00.000Z`,
        `${periodEnd}T23:59:59.999Z`
      )
      const link = document.createElement('a')
      link.href = `data:application/pdf;base64,${result.base64}`
      link.download = result.filename
      link.click()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate dossier')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-mono text-xl font-bold">Teaching dossier</h2>
          <p className="font-mono text-sm text-gray-600">
            Appraisal-ready evidence of your teaching: sessions, hours,
            attendees, and anonymised feedback themes.
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
            {downloading ? 'Generating…' : 'Download dossier'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-3 font-mono text-xs text-red-700">{error}</p>}
    </Card>
  )
}
