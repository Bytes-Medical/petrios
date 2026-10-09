'use client'

import { useState, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { MAX_TENANT_NAME_LENGTH } from '@/lib/tenant-names'

interface InlineRenameFieldProps {
  value: string
  /** Accessible name for the input, e.g. "Organisation name". */
  label: string
  onSave: (name: string) => Promise<unknown>
  textClassName?: string
}

/**
 * Displays a name with a Rename control that swaps to an inline input.
 * Enter saves, Escape cancels; the caller's action runs and the route is
 * refreshed so server-rendered copies of the name update too.
 */
export function InlineRenameField({ value, label, onSave, textClassName }: InlineRenameFieldProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEditing() {
    setDraft(value)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError(null)
  }

  async function save() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      cancel()
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename')
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className={textClassName ?? 'font-mono text-sm'}>{value}</span>
        <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
          Rename
        </Button>
      </div>
    )
  }

  return (
    <div className="min-w-0 flex-1 space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label={label}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={MAX_TENANT_NAME_LENGTH}
          disabled={saving}
          autoFocus
        />
        <div className="flex flex-shrink-0 gap-2">
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={cancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
      {error ? <p className="font-mono text-xs text-red-800">{error}</p> : null}
    </div>
  )
}
