'use client'

import { useRef, useState } from 'react'
import { Button } from './Button'
import { Input } from './Input'
import { searchAddressBook } from '@/app/actions/contacts'
import { contactDisplayName } from '@/lib/contacts'
import type { ExternalContact } from '@/lib/types'

export interface ContactSelection {
  email: string
  firstName?: string
  lastName?: string
  contactId?: string
}

interface ContactPickerProps {
  onSelect: (selection: ContactSelection) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  /** Label above the search input; omit for none. */
  label?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Autocomplete over the org address book, with an inline "quick add" path
 * when the email isn't in the book yet. Selection clears the field.
 */
export function ContactPicker({ onSelect, disabled, placeholder, label }: ContactPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ExternalContact[]>([])
  const [open, setOpen] = useState(false)
  const [quickAdd, setQuickAdd] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function reset() {
    setQuery('')
    setResults([])
    setOpen(false)
    setQuickAdd(false)
    setFirstName('')
    setLastName('')
  }

  function handleChange(value: string) {
    setQuery(value)
    setQuickAdd(false)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (value.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    timeoutRef.current = setTimeout(async () => {
      try {
        const found = await searchAddressBook(value)
        setResults(found)
        setOpen(true)
      } catch {
        setResults([])
        setOpen(true)
      }
    }, 300)
  }

  async function pick(selection: ContactSelection) {
    reset()
    await onSelect(selection)
  }

  const queryIsEmail = EMAIL_RE.test(query.trim())

  return (
    <div className="relative w-full">
      {label && <label className="block mb-1 text-sm font-mono">{label}</label>}
      <Input
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder ?? 'Search the address book or type an email...'}
        disabled={disabled}
      />

      {open && !quickAdd && (
        <div className="absolute z-10 mt-1 w-full border border-black bg-white shadow-lg max-h-60 overflow-y-auto">
          {results.map((contact) => (
            <button
              key={contact.id}
              type="button"
              disabled={disabled}
              onClick={() =>
                pick({
                  email: contact.email,
                  firstName: contact.first_name ?? undefined,
                  lastName: contact.last_name ?? undefined,
                  contactId: contact.id,
                })
              }
              className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-200 last:border-b-0"
            >
              <p className="font-mono text-sm font-bold">{contactDisplayName(contact)}</p>
              <p className="font-mono text-xs text-gray-500">
                {contact.email}
                {contact.role_note ? ` · ${contact.role_note}` : ''}
              </p>
            </button>
          ))}

          {queryIsEmail && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setQuickAdd(true)}
              className="w-full text-left px-4 py-3 hover:bg-clay-50 border-t border-black"
            >
              <p className="font-mono text-sm font-bold text-clay-700">
                + Add &ldquo;{query.trim().toLowerCase()}&rdquo; to the address book
              </p>
            </button>
          )}

          {results.length === 0 && !queryIsEmail && (
            <p className="px-4 py-3 font-mono text-sm text-gray-500">
              No contacts found. Type a full email address to add someone new.
            </p>
          )}
        </div>
      )}

      {open && quickAdd && (
        <div className="absolute z-10 mt-1 w-full border border-black bg-white p-3 shadow-lg space-y-2">
          <p className="font-mono text-xs uppercase tracking-wider text-gray-500">
            New contact — {query.trim().toLowerCase()}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <Input
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() =>
                pick({
                  email: query.trim().toLowerCase(),
                  firstName: firstName.trim() || undefined,
                  lastName: lastName.trim() || undefined,
                })
              }
            >
              Use contact
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setQuickAdd(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
