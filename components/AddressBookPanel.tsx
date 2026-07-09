'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'
import { useToast } from './ToastProvider'
import {
  archiveContact,
  createContact,
  restoreContact,
  updateContactDetails,
} from '@/app/actions/contacts'
import { contactDisplayName } from '@/lib/contacts'
import type { ExternalContact } from '@/lib/types'

interface AddressBookPanelProps {
  contacts: ExternalContact[]
  /** contact_id -> group names, for the chips column. */
  groupsByContact: Record<string, string[]>
}

export function AddressBookPanel({ contacts, groupsByContact }: AddressBookPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  // Inline add form
  const [newEmail, setNewEmail] = useState('')
  const [newFirst, setNewFirst] = useState('')
  const [newLast, setNewLast] = useState('')
  const [newRole, setNewRole] = useState('')

  // Edit-in-place
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  const [editRole, setEditRole] = useState('')

  const visible = contacts.filter((c) => showArchived || !c.archived_at)
  const archivedCount = contacts.filter((c) => c.archived_at).length

  async function handleAdd() {
    if (!newEmail.trim()) return
    setLoading('add')
    try {
      await createContact({
        email: newEmail,
        firstName: newFirst,
        lastName: newLast,
        roleNote: newRole,
      })
      showToast({ variant: 'success', title: 'Contact added' })
      setNewEmail('')
      setNewFirst('')
      setNewLast('')
      setNewRole('')
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to add contact',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  function startEdit(contact: ExternalContact) {
    setEditingId(contact.id)
    setEditFirst(contact.first_name ?? '')
    setEditLast(contact.last_name ?? '')
    setEditRole(contact.role_note ?? '')
  }

  async function handleSaveEdit(contactId: string) {
    setLoading(`edit-${contactId}`)
    try {
      await updateContactDetails(contactId, {
        firstName: editFirst,
        lastName: editLast,
        roleNote: editRole,
      })
      setEditingId(null)
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to update contact',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleArchiveToggle(contact: ExternalContact) {
    setLoading(`archive-${contact.id}`)
    try {
      if (contact.archived_at) {
        await restoreContact(contact.id)
      } else {
        await archiveContact(contact.id)
      }
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to update contact',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        External teachers you invite are captured here automatically. Organise
        them into groups to publish teaching slots to many people at once.
      </p>

      {/* Inline add */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Input
          type="email"
          placeholder="email@example.com"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <Input placeholder="First name" value={newFirst} onChange={(e) => setNewFirst(e.target.value)} />
        <Input placeholder="Last name" value={newLast} onChange={(e) => setNewLast(e.target.value)} />
        <Input placeholder="Role (optional)" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
        <Button
          type="button"
          onClick={handleAdd}
          disabled={!newEmail.trim() || loading === 'add'}
        >
          {loading === 'add' ? 'Adding...' : 'Add'}
        </Button>
      </div>

      {/* Contact list */}
      {visible.length === 0 ? (
        <p className="font-mono text-sm text-gray-500">No contacts yet.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((contact) => (
            <li
              key={contact.id}
              className={`border border-gray-300 p-3 ${contact.archived_at ? 'opacity-60' : ''}`}
            >
              {editingId === contact.id ? (
                <div className="space-y-2">
                  <p className="font-mono text-sm font-bold">{contact.email}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Input placeholder="First name" value={editFirst} onChange={(e) => setEditFirst(e.target.value)} />
                    <Input placeholder="Last name" value={editLast} onChange={(e) => setEditLast(e.target.value)} />
                    <Input placeholder="Role" value={editRole} onChange={(e) => setEditRole(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleSaveEdit(contact.id)}
                      disabled={loading === `edit-${contact.id}`}
                    >
                      {loading === `edit-${contact.id}` ? 'Saving...' : 'Save'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">
                        {contactDisplayName(contact)}
                      </span>
                      {contact.archived_at && <Badge>Archived</Badge>}
                    </div>
                    <p className="font-mono text-xs text-gray-500 break-all">
                      {contact.email}
                      {contact.role_note ? ` · ${contact.role_note}` : ''}
                    </p>
                    {(groupsByContact[contact.id] ?? []).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {groupsByContact[contact.id].map((g) => (
                          <Badge key={g} variant="default" className="normal-case tracking-normal font-normal">
                            {g}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button type="button" size="sm" variant="secondary" onClick={() => startEdit(contact)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={contact.archived_at ? 'secondary' : 'danger'}
                      onClick={() => handleArchiveToggle(contact)}
                      disabled={loading === `archive-${contact.id}`}
                    >
                      {contact.archived_at ? 'Restore' : 'Archive'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {archivedCount > 0 && (
        <button
          type="button"
          className="font-mono text-xs underline underline-offset-2 text-gray-500"
          onClick={() => setShowArchived((s) => !s)}
        >
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>
      )}
    </div>
  )
}
