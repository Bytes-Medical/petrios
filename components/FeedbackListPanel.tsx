'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from './Button'
import { Input } from './Input'
import { formatFeedbackAnswerValue } from '@/lib/feedback-form'
import {
  answeredFeedbackFields,
  filterAndSortFeedbackAudit,
  writtenFeedbackCount,
  type FeedbackAuditEntry,
  type FeedbackAuditScoreBand,
  type FeedbackAuditSort,
} from '@/lib/feedback-audit'

interface FeedbackListPanelProps {
  sessionId: string
}

const DEFAULT_PAGE_SIZE = 10

function scoreTone(rating: number | null) {
  if (rating === null) return 'border-gray-400 bg-gray-50 text-gray-700'
  if (rating < 3) return 'border-red-700 bg-red-50 text-red-800'
  if (rating < 4) return 'border-amber-700 bg-amber-50 text-amber-900'
  return 'border-green-700 bg-green-50 text-green-800'
}

function respondentName(entry: FeedbackAuditEntry) {
  return [entry.attendee_first_name, entry.attendee_last_name].filter(Boolean).join(' ') ||
    'Unnamed respondent'
}

export function FeedbackListPanel({ sessionId }: FeedbackListPanelProps) {
  const [entries, setEntries] = useState<FeedbackAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [scoreBand, setScoreBand] = useState<FeedbackAuditScoreBand>('all')
  const [sort, setSort] = useState<FeedbackAuditSort>('newest')
  const [writtenOnly, setWrittenOnly] = useState(false)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    async function fetchFeedback() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/feedback/audit`)
        if (!response.ok) throw new Error('Failed to fetch feedback')
        setEntries(await response.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feedback')
      } finally {
        setLoading(false)
      }
    }

    fetchFeedback()
  }, [sessionId])

  const filteredEntries = useMemo(
    () => filterAndSortFeedbackAudit(entries, { query, scoreBand, writtenOnly, sort }),
    [entries, query, scoreBand, writtenOnly, sort]
  )
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * pageSize
  const pageEntries = filteredEntries.slice(pageStart, pageStart + pageSize)
  const activeFilterCount = Number(Boolean(query.trim())) + Number(scoreBand !== 'all') + Number(writtenOnly)
  const pageIsExpanded = pageEntries.length > 0 && pageEntries.every((entry) => expandedIds.has(entry.id))

  function resetPage() {
    setPage(1)
    setExpandedIds(new Set())
  }

  function toggleEntry(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function togglePage() {
    setExpandedIds((current) => {
      const next = new Set(current)
      for (const entry of pageEntries) {
        if (pageIsExpanded) next.delete(entry.id)
        else next.add(entry.id)
      }
      return next
    })
  }

  if (loading) {
    return <p className="font-mono text-sm text-gray-600">Loading feedback...</p>
  }

  if (error) {
    return <p className="font-mono text-sm text-red-600">{error}</p>
  }

  if (entries.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No feedback submitted yet.</p>
  }

  return (
    <div className="space-y-4">
      <div className="border border-black bg-gray-50 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_180px_auto] lg:items-end">
          <Input
            label="Search responses"
            type="search"
            value={query}
            placeholder="Name, email, question or response"
            onChange={(event) => {
              setQuery(event.target.value)
              resetPage()
            }}
          />
          <label className="font-mono text-sm">
            <span className="mb-1 block">Score</span>
            <select
              value={scoreBand}
              onChange={(event) => {
                setScoreBand(event.target.value as FeedbackAuditScoreBand)
                resetPage()
              }}
              className="w-full border border-black bg-white px-3 py-2"
            >
              <option value="all">All scores</option>
              <option value="low">Below 3</option>
              <option value="middle">3 to 3.9</option>
              <option value="high">4 and above</option>
            </select>
          </label>
          <label className="font-mono text-sm">
            <span className="mb-1 block">Sort</span>
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as FeedbackAuditSort)
                resetPage()
              }}
              className="w-full border border-black bg-white px-3 py-2"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="lowest">Lowest score first</option>
              <option value="highest">Highest score first</option>
            </select>
          </label>
          <label className="flex min-h-10 items-center gap-2 border border-black bg-white px-3 py-2 font-mono text-sm">
            <input
              type="checkbox"
              checked={writtenOnly}
              onChange={(event) => {
                setWrittenOnly(event.target.checked)
                resetPage()
              }}
              className="h-4 w-4"
            />
            Written feedback only
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs text-gray-600">
        <p>
          Showing {filteredEntries.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + pageSize, filteredEntries.length)} of{' '}
          {filteredEntries.length} matching response{filteredEntries.length === 1 ? '' : 's'}
          {filteredEntries.length !== entries.length ? ` · ${entries.length} total` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {activeFilterCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery('')
                setScoreBand('all')
                setWrittenOnly(false)
                resetPage()
              }}
            >
              Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
            </Button>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={togglePage} disabled={pageEntries.length === 0}>
            {pageIsExpanded ? 'Collapse page' : 'Expand page'}
          </Button>
        </div>
      </div>

      {pageEntries.length === 0 ? (
        <div className="border border-dashed border-gray-400 p-8 text-center font-mono text-sm text-gray-600">
          No responses match these filters.
        </div>
      ) : (
        <ol className="divide-y divide-gray-300 border border-gray-300 bg-white">
          {pageEntries.map((entry) => {
            const expanded = expandedIds.has(entry.id)
            const answeredFields = answeredFeedbackFields(entry)
            const writtenCount = writtenFeedbackCount(entry)

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`feedback-response-${entry.id}`}
                  onClick={() => toggleEntry(entry.id)}
                  className="grid w-full gap-3 px-4 py-3 text-left hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-clay-600 sm:grid-cols-[32px_minmax(180px,1fr)_auto_auto] sm:items-center"
                >
                  <span className="flex h-7 w-7 items-center justify-center border border-black font-mono text-lg" aria-hidden="true">
                    {expanded ? '−' : '+'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-sm font-bold">{respondentName(entry)}</span>
                    <span className="block truncate font-mono text-xs text-gray-500">{entry.attendee_email || 'No email recorded'}</span>
                  </span>
                  <span className={`w-fit border px-2 py-1 font-mono text-xs font-bold ${scoreTone(entry.rating)}`}>
                    {entry.rating === null ? 'No score' : `${entry.rating.toFixed(1)} / 5`}
                  </span>
                  <span className="font-mono text-xs text-gray-500 sm:text-right">
                    {answeredFields.length} answer{answeredFields.length === 1 ? '' : 's'}
                    {writtenCount > 0 ? ` · ${writtenCount} written` : ''}
                    <span className="block mt-1">{new Date(entry.created_at).toLocaleString('en-GB')}</span>
                  </span>
                </button>

                {expanded && (
                  <div id={`feedback-response-${entry.id}`} className="border-t border-gray-200 bg-gray-50 px-4 py-5 sm:pl-16">
                    {answeredFields.length > 0 ? (
                      <div className="grid gap-4 xl:grid-cols-2">
                        {answeredFields.map((answer) => (
                          <div key={`${entry.id}-${answer.fieldId}`} className="border-l-2 border-black pl-3">
                            <p className="font-mono text-xs uppercase tracking-[0.14em] text-gray-500">{answer.label}</p>
                            <p className="mt-1 font-mono text-sm font-bold">{formatFeedbackAnswerValue(answer)}</p>
                            {answer.comment ? (
                              <p className="mt-2 font-mono text-sm leading-6 text-gray-700">{answer.comment}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : entry.comment ? (
                      <p className="font-mono text-sm leading-6 text-gray-700">{entry.comment}</p>
                    ) : (
                      <p className="font-mono text-sm text-gray-500">No answer detail was stored.</p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-300 pt-4">
        <label className="flex items-center gap-2 font-mono text-xs text-gray-600">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value))
              resetPage()
            }}
            className="border border-black bg-white px-2 py-1 text-black"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
          </select>
        </label>
        <div className="flex items-center gap-3">
          <Button type="button" size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            Previous
          </Button>
          <span className="font-mono text-xs">Page {safePage} of {totalPages}</span>
          <Button type="button" size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
