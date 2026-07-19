'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  approveAndSendWeeklyNewsletter,
  generateWeeklyNewsletter,
  retryWeeklyNewsletter,
  saveWeeklyNewsletter,
} from '@/app/actions/ops'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Select } from '@/components/Select'
import {
  NEWSLETTER_MAX_WORDS,
  newsletterWordCount,
} from '@/lib/ops/newsletter'
import type {
  OpsNewsletterContent,
  OpsNewsletterIssue,
  OpsNewsletterStatus,
} from '@/lib/types'

interface DepartmentOption {
  id: string
  name: string
  memberCount: number
}

interface NewsletterWorkspaceProps {
  departments: DepartmentOption[]
  issues: OpsNewsletterIssue[]
  defaultWeekStart: string
}

const STATUS_VARIANT: Record<OpsNewsletterStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning',
  approved: 'default',
  sent: 'success',
  failed: 'danger',
}

function formatWeek(weekStart: string) {
  return new Date(`${weekStart}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function NewsletterGenerator({
  departments,
  defaultWeekStart,
}: Pick<NewsletterWorkspaceProps, 'departments' | 'defaultWeekStart'>) {
  const router = useRouter()
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? '')
  const [weekStart, setWeekStart] = useState(defaultWeekStart)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => {
      setProgress((current) => Math.min(92, current + (current < 55 ? 7 : 2)))
    }, 900)
    return () => window.clearInterval(timer)
  }, [busy])

  async function generate() {
    if (!departmentId || !weekStart) return
    setProgress(8)
    setBusy(true)
    setError(null)
    try {
      await generateWeeklyNewsletter(departmentId, weekStart)
      setProgress(100)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Newsletter generation failed')
      setProgress(0)
    } finally {
      setBusy(false)
    }
  }

  if (departments.length === 0) {
    return (
      <Card>
        <p className="font-mono text-sm text-gray-600">
          You are not a moderator for a department in this organisation.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <h2 className="font-mono text-xl font-bold">Generate a weekly teaching summary</h2>
      <p className="mt-1 font-mono text-sm leading-6 text-gray-600">
        Choose any Monday–Sunday week that has started — a mid-week draft covers the sessions ended so far, and you can regenerate it before sending. Petrios reads every published
        teaching session in the department and all currently available PDF,
        Word, and PowerPoint teaching materials, then prepares a concise
        one-page draft. Nothing is emailed until you review and approve it.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_190px_auto] sm:items-end">
        <label className="font-mono text-xs font-bold uppercase tracking-wider">
          Department
          <Select
            className="mt-1 w-full"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name} ({department.memberCount} members)
              </option>
            ))}
          </Select>
        </label>
        <label className="font-mono text-xs font-bold uppercase tracking-wider">
          Week commencing
          <input
            type="date"
            value={weekStart}
            onChange={(event) => setWeekStart(event.target.value)}
            className="mt-1 w-full border border-black bg-white px-3 py-2 font-mono text-sm"
          />
        </label>
        <Button onClick={generate} disabled={busy || !departmentId || !weekStart}>
          {busy ? 'Generating…' : 'Generate draft'}
        </Button>
      </div>
      {busy && (
        <div className="mt-4" aria-label={`Newsletter generation ${progress}%`}>
          <div className="mb-1 flex justify-between font-mono text-xs text-gray-600">
            <span>Reading teaching materials and composing the one-page summary…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-3 border border-black bg-gray-100">
            <div
              className="h-full bg-clay-600 transition-[width] duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {error && (
        <p className="mt-3 border border-red-700 bg-red-50 p-3 font-mono text-xs text-red-800">
          {error}
        </p>
      )}
    </Card>
  )
}

function NewsletterIssueEditor({
  issue,
  department,
}: {
  issue: OpsNewsletterIssue
  department: DepartmentOption
}) {
  const router = useRouter()
  const [content, setContent] = useState<OpsNewsletterContent>(issue.content!)
  const [revision, setRevision] = useState(issue.content_revision)
  const [busy, setBusy] = useState<'save' | 'send' | 'retry' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const words = useMemo(() => newsletterWordCount(content), [content])
  const editable = ['draft', 'failed'].includes(issue.status) && issue.sent_count === 0

  function updateSession(index: number, patch: Partial<OpsNewsletterContent['sessions'][number]>) {
    setContent((current) => ({
      ...current,
      sessions: current.sessions.map((session, sessionIndex) =>
        sessionIndex === index ? { ...session, ...patch } : session
      ),
    }))
  }

  function updatePoint(sessionIndex: number, pointIndex: number, value: string) {
    const session = content.sessions[sessionIndex]
    updateSession(sessionIndex, {
      learning_points: session.learning_points.map((point, index) =>
        index === pointIndex ? value : point
      ),
    })
  }

  async function save() {
    setBusy('save')
    setError(null)
    try {
      const result = await saveWeeklyNewsletter(issue.id, content, revision)
      setRevision(result.revision)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save newsletter')
    } finally {
      setBusy(null)
    }
  }

  async function send() {
    if (!window.confirm(`Email this reviewed newsletter to eligible members of ${department.name}?`)) return
    setBusy('send')
    setError(null)
    try {
      await approveAndSendWeeklyNewsletter(issue.id, content, revision)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Newsletter delivery failed')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  async function retry() {
    setBusy('retry')
    setError(null)
    try {
      await retryWeeklyNewsletter(issue.id)
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Newsletter retry failed')
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-gray-500">
            {department.name} · week commencing {formatWeek(issue.week_start)}
          </p>
          <h2 className="mt-1 font-mono text-lg font-bold">{content.subject}</h2>
          <p className="mt-1 font-mono text-xs text-gray-500">
            {issue.source_session_ids.length} teaching session(s) · {issue.source_documents.length} teaching document(s) · revision {revision}
            {issue.sent_count > 0 ? ` · ${issue.sent_count} delivered` : ''}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[issue.status]}>{issue.status}</Badge>
      </div>

      <details className="mt-4 border border-black" open={issue.status === 'draft'}>
        <summary className="cursor-pointer px-4 py-3 font-mono text-sm font-bold">
          Review and edit the one-page summary
        </summary>
        <div className="space-y-4 border-t border-black p-4">
          <label className="block font-mono text-xs font-bold uppercase tracking-wider">
            Email subject
            <input
              value={content.subject}
              disabled={!editable}
              onChange={(event) => setContent((current) => ({ ...current, subject: event.target.value }))}
              className="mt-1 w-full border border-black px-3 py-2 font-mono text-sm font-normal normal-case tracking-normal"
            />
          </label>
          <label className="block font-mono text-xs font-bold uppercase tracking-wider">
            Introduction
            <textarea
              value={content.intro}
              disabled={!editable}
              rows={3}
              onChange={(event) => setContent((current) => ({ ...current, intro: event.target.value }))}
              className="mt-1 w-full border border-black px-3 py-2 font-mono text-sm font-normal normal-case tracking-normal"
            />
          </label>

          {content.sessions.map((session, sessionIndex) => (
            <div key={session.session_id} className="border border-black bg-clay-50 p-4">
              <p className="font-mono text-xs uppercase tracking-wider text-clay-800">
                {session.date_label}
              </p>
              <h3 className="font-mono text-sm font-bold">{session.title}</h3>
              <textarea
                aria-label={`Overview for ${session.title}`}
                value={session.overview}
                disabled={!editable}
                rows={3}
                onChange={(event) => updateSession(sessionIndex, { overview: event.target.value })}
                className="mt-3 w-full border border-black bg-white px-3 py-2 font-mono text-sm"
              />
              <div className="mt-3 space-y-2">
                {session.learning_points.map((point, pointIndex) => (
                  <div key={pointIndex} className="flex gap-2">
                    <span className="pt-2 font-mono text-sm">•</span>
                    <input
                      aria-label={`Learning point ${pointIndex + 1} for ${session.title}`}
                      value={point}
                      disabled={!editable}
                      onChange={(event) => updatePoint(sessionIndex, pointIndex, event.target.value)}
                      className="min-w-0 flex-1 border border-black bg-white px-3 py-2 font-mono text-sm"
                    />
                    {editable && session.learning_points.length > 1 && (
                      <button
                        type="button"
                        onClick={() => updateSession(sessionIndex, {
                          learning_points: session.learning_points.filter((_, index) => index !== pointIndex),
                        })}
                        className="px-2 font-mono text-xs underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editable && session.learning_points.length < 3 && (
                <button
                  type="button"
                  onClick={() => updateSession(sessionIndex, {
                    learning_points: [...session.learning_points, ''],
                  })}
                  className="mt-2 font-mono text-xs underline underline-offset-2"
                >
                  Add learning point
                </button>
              )}
            </div>
          ))}

          <label className="block font-mono text-xs font-bold uppercase tracking-wider">
            Closing
            <textarea
              value={content.closing}
              disabled={!editable}
              rows={2}
              onChange={(event) => setContent((current) => ({ ...current, closing: event.target.value }))}
              className="mt-1 w-full border border-black px-3 py-2 font-mono text-sm font-normal normal-case tracking-normal"
            />
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-300 pt-4">
            <p className={`font-mono text-xs ${words > NEWSLETTER_MAX_WORDS ? 'text-red-700' : 'text-gray-500'}`}>
              {words} / {NEWSLETTER_MAX_WORDS} words
            </p>
            <div className="flex flex-wrap gap-2">
              {editable && (
                <>
                  <Button variant="secondary" onClick={save} disabled={busy !== null || words > NEWSLETTER_MAX_WORDS}>
                    {busy === 'save' ? 'Saving…' : 'Save draft'}
                  </Button>
                  <Button onClick={send} disabled={busy !== null || words > NEWSLETTER_MAX_WORDS}>
                    {busy === 'send' ? 'Emailing…' : 'Approve & email department'}
                  </Button>
                </>
              )}
              {!editable && issue.status !== 'sent' && (
                <Button onClick={retry} disabled={busy !== null}>
                  {busy === 'retry' ? 'Retrying…' : 'Retry unfinished delivery'}
                </Button>
              )}
            </div>
          </div>
          {error && (
            <p className="border border-red-700 bg-red-50 p-3 font-mono text-xs text-red-800">
              {error}
            </p>
          )}
        </div>
      </details>

      {issue.source_documents.length > 0 && (
        <details className="mt-3 border border-gray-300 bg-gray-50 p-3">
          <summary className="cursor-pointer font-mono text-xs font-bold">
            Teaching materials processed ({issue.source_documents.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs text-gray-600">
            {issue.source_documents.map((document) => (
              <li key={document.id}>
                {document.sessionTitle} — {document.filename}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-3 border border-gray-300 bg-gray-50 p-3">
        <summary className="cursor-pointer font-mono text-xs font-bold">
          Preview saved email design
        </summary>
        {/* buildNewsletterHtml escapes every dynamic field before storage. */}
        <div
          className="mt-3 overflow-hidden border border-gray-300 bg-white"
          dangerouslySetInnerHTML={{ __html: issue.html }}
        />
      </details>
    </Card>
  )
}

export function NewsletterWorkspace({
  departments,
  issues,
  defaultWeekStart,
}: NewsletterWorkspaceProps) {
  const departmentById = new Map(departments.map((department) => [department.id, department]))
  return (
    <div className="space-y-6">
      <NewsletterGenerator departments={departments} defaultWeekStart={defaultWeekStart} />
      {issues.length === 0 ? (
        <Card>
          <p className="font-mono text-sm text-gray-600">
            No departmental newsletter drafts yet. Generate one from a completed teaching week above.
          </p>
        </Card>
      ) : (
        issues.map((issue) => {
          const department = issue.department_id ? departmentById.get(issue.department_id) : null
          if (!department || !issue.content) return null
          return <NewsletterIssueEditor key={issue.id} issue={issue} department={department} />
        })
      )}
    </div>
  )
}
