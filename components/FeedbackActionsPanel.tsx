'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import {
  createFeedbackAction,
  deleteFeedbackAction,
  updateFeedbackAction,
} from '@/app/actions/feedback-actions'
import type { FeedbackAction } from '@/lib/db/feedback-actions'

// Mirrors MAX_FEEDBACK_ACTION_FIELD_LENGTH in app/actions/feedback-actions.ts
const MAX_LEN = 280

/**
 * Moderator CRUD for "You said, we did" entries. Everything saved here
 * renders publicly on the session and department feedback pages.
 */
export function FeedbackActionsPanel({
  sessionId,
  initialActions,
}: {
  sessionId: string
  initialActions: FeedbackAction[]
}) {
  const router = useRouter()
  const [theme, setTheme] = useState('')
  const [action, setAction] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setTheme('')
      setAction('')
      setEditingId(null)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(entry: FeedbackAction) {
    setEditingId(entry.id)
    setTheme(entry.theme)
    setAction(entry.action)
    setError(null)
  }

  return (
    <div className="space-y-6">
      <p className="font-mono text-sm text-gray-600">
        Close the loop: record what changed in response to feedback. Entries
        appear publicly on this session&apos;s feedback page and the
        department feedback page.
      </p>

      {error && (
        <div className="border border-red-500 bg-red-50 p-3">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-gray-500">
            You said
          </label>
          <input
            type="text"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            maxLength={MAX_LEN}
            placeholder="e.g. Sessions felt rushed at the end"
            className="w-full border border-black p-2 font-mono text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block font-mono text-xs uppercase tracking-wide text-gray-500">
            We did
          </label>
          <input
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            maxLength={MAX_LEN}
            placeholder="e.g. Extended future sessions to 45 minutes"
            className="w-full border border-black p-2 font-mono text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={busy || !theme.trim() || !action.trim()}
            onClick={() =>
              run(() =>
                editingId
                  ? updateFeedbackAction(editingId, { theme, action })
                  : createFeedbackAction(sessionId, { theme, action })
              )
            }
          >
            {busy ? 'Saving…' : editingId ? 'Save changes' : 'Add entry'}
          </Button>
          {editingId && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setEditingId(null)
                setTheme('')
                setAction('')
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      {initialActions.length > 0 ? (
        <div className="space-y-3">
          {initialActions.map((entry) => (
            <div key={entry.id} className="border border-gray-300 p-4">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-gray-500">
                You said
              </p>
              <p className="mt-1 font-mono text-sm leading-6">{entry.theme}</p>
              <div className="mt-2 border-l-2 border-clay-600 pl-3">
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-gray-500">
                  We did
                </p>
                <p className="mt-1 font-mono text-sm leading-6">{entry.action}</p>
              </div>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => startEdit(entry)}
                  className="font-mono text-xs underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => run(() => deleteFeedbackAction(entry.id))}
                  className="font-mono text-xs text-red-700 underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-mono text-sm text-gray-500">No entries yet.</p>
      )}
    </div>
  )
}
