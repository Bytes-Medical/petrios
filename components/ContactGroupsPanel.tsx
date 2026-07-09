'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { ContactPicker, type ContactSelection } from './ContactPicker'
import { useToast } from './ToastProvider'
import {
  addContactToGroup,
  createContact,
  createContactGroup,
  deleteContactGroup,
  getContactGroupMembers,
  removeContactFromGroup,
  renameContactGroup,
} from '@/app/actions/contacts'
import { contactDisplayName } from '@/lib/contacts'
import type { ContactGroupWithCount, ExternalContact } from '@/lib/types'

interface ContactGroupsPanelProps {
  groups: ContactGroupWithCount[]
}

export function ContactGroupsPanel({ groups }: ContactGroupsPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState<string | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [members, setMembers] = useState<ExternalContact[]>([])
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  async function refreshMembers(groupId: string) {
    const list = await getContactGroupMembers(groupId)
    setMembers(list)
  }

  async function toggleExpand(groupId: string) {
    if (expandedId === groupId) {
      setExpandedId(null)
      setMembers([])
      return
    }
    setExpandedId(groupId)
    setMembers([])
    try {
      await refreshMembers(groupId)
    } catch {
      showToast({ variant: 'error', title: 'Failed to load group members' })
    }
  }

  async function handleCreate() {
    if (!newGroupName.trim()) return
    setLoading('create')
    try {
      await createContactGroup(newGroupName)
      setNewGroupName('')
      showToast({ variant: 'success', title: 'Group created' })
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to create group',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRename(groupId: string) {
    setLoading(`rename-${groupId}`)
    try {
      await renameContactGroup(groupId, renameValue)
      setRenamingId(null)
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to rename group',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleDelete(groupId: string) {
    setLoading(`delete-${groupId}`)
    try {
      await deleteContactGroup(groupId)
      if (expandedId === groupId) setExpandedId(null)
      showToast({ variant: 'success', title: 'Group deleted' })
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to delete group',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleAddMember(groupId: string, selection: ContactSelection) {
    setLoading(`add-${groupId}`)
    try {
      let contactId = selection.contactId
      if (!contactId) {
        const contact = await createContact({
          email: selection.email,
          firstName: selection.firstName,
          lastName: selection.lastName,
        })
        contactId = contact.id
      }
      await addContactToGroup(groupId, contactId)
      await refreshMembers(groupId)
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to add to group',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  async function handleRemoveMember(groupId: string, contactId: string) {
    setLoading(`remove-${contactId}`)
    try {
      await removeContactFromGroup(groupId, contactId)
      await refreshMembers(groupId)
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Failed to remove from group',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-gray-600">
        Groups (e.g. &ldquo;Consultants&rdquo;) let you publish teaching slots to
        many contacts at once.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="New group name"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          className="flex-1"
        />
        <Button
          type="button"
          onClick={handleCreate}
          disabled={!newGroupName.trim() || loading === 'create'}
          className="w-full sm:w-auto"
        >
          {loading === 'create' ? 'Creating...' : 'Create Group'}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="font-mono text-sm text-gray-500">No groups yet.</p>
      ) : (
        <ul className="space-y-2">
          {groups.map((group) => (
            <li key={group.id} className="border border-gray-300">
              <div className="flex flex-wrap items-center justify-between gap-2 p-3">
                {renamingId === group.id ? (
                  <div className="flex flex-1 gap-2">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleRename(group.id)}
                      disabled={!renameValue.trim() || loading === `rename-${group.id}`}
                    >
                      Save
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => toggleExpand(group.id)}
                      className="font-mono text-sm font-bold underline-offset-4 hover:underline"
                    >
                      {expandedId === group.id ? '▾' : '▸'} {group.name}{' '}
                      <span className="font-normal text-gray-500">({group.member_count})</span>
                    </button>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setRenamingId(group.id)
                          setRenameValue(group.name)
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        onClick={() => handleDelete(group.id)}
                        disabled={loading === `delete-${group.id}`}
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>

              {expandedId === group.id && (
                <div className="border-t border-gray-300 p-3 space-y-3">
                  <ContactPicker
                    onSelect={(selection) => handleAddMember(group.id, selection)}
                    disabled={loading === `add-${group.id}`}
                    placeholder="Add a contact to this group..."
                  />
                  {members.length === 0 ? (
                    <p className="font-mono text-xs text-gray-500">No contacts in this group yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {members.map((contact) => (
                        <li
                          key={contact.id}
                          className="flex flex-wrap items-center justify-between gap-2 border border-gray-200 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <span className="font-mono text-sm">{contactDisplayName(contact)}</span>
                            <span className="ml-2 font-mono text-xs text-gray-500 break-all">
                              {contact.email}
                            </span>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveMember(group.id, contact.id)}
                            disabled={loading === `remove-${contact.id}`}
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
