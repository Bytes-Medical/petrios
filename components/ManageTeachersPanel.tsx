'use client'

import { useRef, useState } from 'react'
import { Badge } from './Badge'
import { Button } from './Button'
import { Input } from './Input'
import { ContactPicker, type ContactSelection } from './ContactPicker'
import { useToast } from './ToastProvider'
import { addSessionTeacher, removeSessionTeacher, searchOrgMembersForTeacher } from '@/app/actions/sessions'
import { sendTeacherEmail } from '@/app/actions/emails'
import { inviteExternalTeacher, deleteTeacherInvitation } from '@/app/actions/teacher-invitations'
import type { EmailType, TeacherInvitation } from '@/lib/types'
import type { OrgMemberProfile } from '@/lib/db/sessions'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'

interface ManageTeachersPanelProps {
  sessionId: string
  currentTeachers: { id: string; user_id: string; status?: string }[]
  departmentMembers: { id: string; email: string | null }[]
  emailHistory: { user_id: string; email_type: string; sent_at: string }[]
  invitations: TeacherInvitation[]
}

export function ManageTeachersPanel({
  sessionId,
  currentTeachers,
  departmentMembers,
  emailHistory,
  invitations,
}: ManageTeachersPanelProps) {
  const { showToast } = useToast()
  // pendingKey keeps the same string keys the JSX already checks; the
  // transition keeps buttons pending until the refreshed data renders.
  const { pendingKey: loading, run } = useActionWithRefresh()

  // Autocomplete state for internal teacher assignment
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<OrgMemberProfile[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(value: string) {
    setSearchQuery(value)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (value.trim().length < 2) {
      setSearchResults([])
      setSearchOpen(false)
      return
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchOrgMembersForTeacher(value)
        // Filter out already-assigned teachers
        const assignedIds = new Set(currentTeachers.map((t) => t.user_id))
        setSearchResults(results.filter((r) => !assignedIds.has(r.user_id)))
        setSearchOpen(true)
      } catch {
        setSearchResults([])
      }
    }, 300)
  }

  function handleAssignInternal(member: OrgMemberProfile) {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    run(async () => {
      try {
        await addSessionTeacher(sessionId, member.user_id)
        try {
          await sendTeacherEmail(sessionId, member.user_id, 'INVITATION')
        } catch {
          // Non-fatal — teacher is assigned even if email fails
        }
        showToast({ variant: 'success', title: `${member.full_name || member.email} assigned as teacher` })
      } catch (err) {
        showToast({ variant: 'error', title: 'Failed to assign teacher', description: err instanceof Error ? err.message : undefined })
        throw err
      }
    }, 'assign')
  }

  function handleInvite(selection: ContactSelection) {
    run(async () => {
      try {
        const result = await inviteExternalTeacher(sessionId, selection.email, {
          firstName: selection.firstName,
          lastName: selection.lastName,
        })
        if (result.emailSent === false) {
          showToast({ variant: 'info', title: 'Invitation created', description: `Email could not be sent: ${result.emailError}` })
        } else {
          showToast({ variant: 'success', title: 'Invitation sent' })
        }
      } catch (err) {
        showToast({ variant: 'error', title: 'Failed to send invitation', description: err instanceof Error ? err.message : undefined })
        throw err
      }
    }, 'invite')
  }

  function handleRemoveTeacher(userId: string) {
    run(async () => {
      try {
        await removeSessionTeacher(sessionId, userId)
      } catch (err) {
        showToast({ variant: 'error', title: 'Failed to remove teacher', description: err instanceof Error ? err.message : undefined })
        throw err
      }
    }, `remove-${userId}`)
  }

  function handleSendEmail(userId: string, emailType: EmailType) {
    run(async () => {
      try {
        await sendTeacherEmail(sessionId, userId, emailType)
        showToast({ variant: 'success', title: `${emailType === 'INVITATION' ? 'Invitation' : 'Reminder'} sent` })
      } catch (err) {
        showToast({ variant: 'error', title: `Failed to send ${emailType.toLowerCase()}`, description: err instanceof Error ? err.message : undefined })
        throw err
      }
    }, `${emailType.toLowerCase()}-${userId}`)
  }

  function handleResendInvitation(invitation: TeacherInvitation) {
    run(async () => {
      try {
        await inviteExternalTeacher(sessionId, invitation.email)
        showToast({ variant: 'success', title: 'Invitation resent' })
      } catch (err) {
        // If existing pending, that's fine — the email was already sent
        if (err instanceof Error && err.message.includes('already been sent')) {
          showToast({ variant: 'error', title: err.message })
        } else {
          showToast({ variant: 'error', title: 'Failed to resend invitation', description: err instanceof Error ? err.message : undefined })
        }
        throw err
      }
    }, `resend-${invitation.id}`)
  }

  function handleDeleteInvitation(invitationId: string) {
    run(async () => {
      try {
        await deleteTeacherInvitation(sessionId, invitationId)
      } catch (err) {
        showToast({ variant: 'error', title: 'Failed to delete invitation', description: err instanceof Error ? err.message : undefined })
        throw err
      }
    }, `delete-${invitationId}`)
  }

  function getLastEmail(userId: string, emailType: string) {
    return emailHistory
      .filter(e => e.user_id === userId && e.email_type === emailType)
      .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime())[0]
  }

  const statusBadge = (status: string) => {
    const variants: Record<string, 'warning' | 'success' | 'danger'> = {
      PENDING: 'warning',
      ACCEPTED: 'success',
      DECLINED: 'danger',
    }
    return <Badge variant={variants[status] ?? 'default'}>{status}</Badge>
  }

  return (
    <div className="space-y-6">
      {/* Assign Internal Teacher */}
      <div className="relative">
        <h3 className="font-mono font-bold mb-2">Assign Teacher</h3>
        <p className="font-mono text-xs text-gray-500 mb-2">
          Search by name or email to assign an internal member.
        </p>
        <Input
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Start typing a name or email..."
          className="w-full"
        />
        {searchOpen && searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 w-full border border-black bg-white shadow-lg max-h-60 overflow-y-auto">
            {searchResults.map((member) => (
              <button
                key={member.user_id}
                type="button"
                onClick={() => handleAssignInternal(member)}
                disabled={loading === 'assign'}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-200 last:border-b-0"
              >
                <p className="font-mono text-sm font-bold">
                  {member.full_name || [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email}
                </p>
                <p className="font-mono text-xs text-gray-500">{member.email}</p>
              </button>
            ))}
          </div>
        )}
        {searchOpen && searchResults.length === 0 && searchQuery.length >= 2 && (
          <div className="absolute z-10 mt-1 w-full border border-black bg-white px-4 py-3">
            <p className="font-mono text-sm text-gray-500">No members found. Use the invite form below for external teachers.</p>
          </div>
        )}
      </div>

      {/* Invite External Teacher via the address book */}
      <div>
        <h3 className="font-mono font-bold mb-2">Invite External Teacher</h3>
        <p className="font-mono text-xs text-gray-500 mb-2">
          Pick from the address book, or type a new email to add and invite in
          one step. Selecting a contact sends the invitation immediately.
        </p>
        <ContactPicker onSelect={handleInvite} disabled={loading === 'invite'} />
      </div>

      {/* Invitations */}
      {invitations.length > 0 && (
        <div>
          <h3 className="font-mono font-bold mb-2">Invitations</h3>
          <ul className="space-y-3">
            {invitations.map(invitation => (
              <li key={invitation.id} className="p-3 border border-gray-300 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-bold">{invitation.email}</span>
                  {statusBadge(invitation.status)}
                </div>

                {invitation.first_name && invitation.last_name && (
                  <p className="font-mono text-xs text-gray-600">
                    Name: {invitation.first_name} {invitation.last_name}
                  </p>
                )}

                <p className="font-mono text-xs text-gray-500">
                  Sent: {new Date(invitation.sent_at).toLocaleString('en-GB')}
                  {invitation.responded_at && (
                    <> | Responded: {new Date(invitation.responded_at).toLocaleString('en-GB')}</>
                  )}
                </p>

                <div className="flex gap-2 flex-wrap">
                  {invitation.status === 'PENDING' && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleResendInvitation(invitation)}
                      disabled={loading === `resend-${invitation.id}`}
                      className="text-xs"
                    >
                      {loading === `resend-${invitation.id}` ? 'Sending...' : 'Resend Invitation'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => handleDeleteInvitation(invitation.id)}
                    disabled={loading === `delete-${invitation.id}`}
                    className="text-xs"
                  >
                    {loading === `delete-${invitation.id}` ? 'Removing...' : 'Remove'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Current Teachers (existing department members assigned) */}
      {currentTeachers.length > 0 && (
        <div>
          <h3 className="font-mono font-bold mb-2">Assigned Teachers</h3>
          <ul className="space-y-3">
            {currentTeachers.map(teacher => {
              const member = departmentMembers.find(m => m.id === teacher.user_id)
              const lastInvitation = getLastEmail(teacher.user_id, 'INVITATION')
              const lastReminder = getLastEmail(teacher.user_id, 'REMINDER')

              return (
                <li key={teacher.id} className="p-3 border border-gray-300 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold">{member?.email || teacher.user_id}</span>
                    {teacher.status ? statusBadge(teacher.status) : null}
                  </div>

                  <div className="font-mono text-xs text-gray-500 space-y-0.5">
                    {lastInvitation ? (
                      <p>Invited: {new Date(lastInvitation.sent_at).toLocaleString('en-GB')}</p>
                    ) : null}
                    {lastReminder ? (
                      <p>Reminded: {new Date(lastReminder.sent_at).toLocaleString('en-GB')}</p>
                    ) : null}
                    {!lastInvitation && !lastReminder && (
                      <p>No emails sent yet</p>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleSendEmail(teacher.user_id, 'INVITATION')}
                      disabled={loading === `invitation-${teacher.user_id}`}
                      className="text-xs"
                    >
                      {loading === `invitation-${teacher.user_id}` ? 'Sending...' : 'Send Invitation'}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => handleSendEmail(teacher.user_id, 'REMINDER')}
                      disabled={loading === `reminder-${teacher.user_id}`}
                      className="text-xs"
                    >
                      {loading === `reminder-${teacher.user_id}` ? 'Sending...' : 'Send Reminder'}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => handleRemoveTeacher(teacher.user_id)}
                      disabled={loading === `remove-${teacher.user_id}`}
                      className="text-xs"
                    >
                      {loading === `remove-${teacher.user_id}` ? 'Removing...' : 'Remove'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
