'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { useToast } from '@/components/ToastProvider'
import { removeOrgMember } from '@/app/actions/member-onboarding'
import type { ManagedOrgMember } from '@/lib/types'

interface OrgMembersPanelProps {
  members: ManagedOrgMember[]
}

const ROLE_LABELS: Record<string, string> = {
  org_admin: 'Admin',
  department_admin: 'Moderator',
  faculty: 'Faculty',
  trainee: 'Trainee',
}

function formatMemberName(member: ManagedOrgMember) {
  if (member.full_name?.trim()) {
    return member.full_name
  }

  const fallbackName = [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
  return fallbackName || member.email
}

export function OrgMembersPanel({ members }: OrgMembersPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null)

  async function handleRemove(userId: string) {
    setLoadingUserId(userId)

    try {
      await removeOrgMember(userId)
      showToast({
        variant: 'success',
        title: 'Member removed',
        description: 'The user has been removed from this organization.',
      })
      router.refresh()
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Removal failed',
        description: error instanceof Error ? error.message : 'Failed to remove member',
      })
    } finally {
      setLoadingUserId(null)
    }
  }

  if (members.length === 0) {
    return <p className="font-mono text-sm text-gray-600">No members found in this organization.</p>
  }

  return (
    <div className="divide-y divide-gray-200">
      {members.map((member) => (
        <div
          key={member.user_id}
          className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <p className="truncate font-mono text-sm font-bold">
              {formatMemberName(member)}
              <span className="ml-2 bg-gray-100 px-1.5 py-0.5 text-xs font-normal">
                {ROLE_LABELS[member.role] ?? member.role}
              </span>
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-gray-600">
              {member.email}
              {member.department_names.length > 0
                ? ` · ${member.department_names.join(', ')}`
                : ''}
              {' · joined '}
              {new Date(member.joined_at).toLocaleDateString('en-GB')}
            </p>
          </div>

          {member.removable ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingUserId === member.user_id}
              onClick={() => handleRemove(member.user_id)}
            >
              {loadingUserId === member.user_id ? 'Removing…' : 'Remove'}
            </Button>
          ) : (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-gray-400">
              Protected
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
