'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from './Badge'
import { Button } from './Button'
import { useToast } from './ToastProvider'
import { respondToTeachingAssignment } from '@/app/actions/teaching-assignments'
import type { TeachingAssignment } from '@/lib/db/trainee-dashboard'

const LOCATION_LABELS: Record<string, string> = {
  MS_TEAMS: 'Online',
  IN_PERSON: 'In Person',
  HYBRID: 'Hybrid',
}

interface TeachingAssignmentsPanelProps {
  assignments: TeachingAssignment[]
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function TeachingAssignmentsPanel({ assignments }: TeachingAssignmentsPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [responding, setResponding] = useState<string | null>(null)

  const pending = assignments.filter((a) => a.status === 'PENDING')
  const upcomingAccepted = assignments.filter(
    (a) => a.status === 'ACCEPTED' && new Date(a.date_start) > new Date()
  )

  async function respond(sessionId: string, accept: boolean) {
    setResponding(`${sessionId}-${accept}`)
    try {
      await respondToTeachingAssignment(sessionId, accept)
      showToast({
        title: accept ? 'Invitation accepted' : 'Invitation declined',
        description: accept
          ? 'The session now shows under your upcoming sessions.'
          : 'The organiser has been notified.',
        variant: 'success',
      })
      router.refresh()
    } catch (err) {
      showToast({
        title: 'Something went wrong',
        description: err instanceof Error ? err.message : 'Try again.',
        variant: 'error',
      })
    } finally {
      setResponding(null)
    }
  }

  if (assignments.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">
        No teaching invitations yet. When a session organiser invites you to
        teach, it will appear here for you to accept or decline.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
            Awaiting your response
          </h3>
          <div className="space-y-3">
            {pending.map((a) => (
              <div key={a.session_id} className="border border-black border-l-4 border-l-clay-600 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold">{a.title}</p>
                    <p className="mt-1 font-mono text-xs text-gray-600">
                      {formatWhen(a.date_start)} ·{' '}
                      {LOCATION_LABELS[a.location_type] || a.location_type}
                      {a.department_name ? ` · ${a.department_name}` : ''}
                    </p>
                  </div>
                  <Badge variant="warning">Pending</Badge>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    size="sm"
                    onClick={() => respond(a.session_id, true)}
                    disabled={responding !== null}
                  >
                    {responding === `${a.session_id}-true` ? 'Accepting…' : 'Accept'}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => respond(a.session_id, false)}
                    disabled={responding !== null}
                  >
                    {responding === `${a.session_id}-false` ? 'Declining…' : 'Decline'}
                  </Button>
                  <Link
                    href={`/sessions/${a.session_id}`}
                    className="font-mono text-xs underline underline-offset-4 self-center"
                  >
                    View session
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingAccepted.length > 0 && (
        <div>
          <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
            Upcoming teaching
          </h3>
          <div className="space-y-3">
            {upcomingAccepted.map((a) => (
              <Link
                key={a.session_id}
                href={`/sessions/${a.session_id}`}
                className="block border border-black bg-white p-4 hover:bg-gray-50"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold">{a.title}</p>
                    <p className="mt-1 font-mono text-xs text-gray-600">
                      {formatWhen(a.date_start)} ·{' '}
                      {LOCATION_LABELS[a.location_type] || a.location_type}
                      {a.department_name ? ` · ${a.department_name}` : ''}
                    </p>
                  </div>
                  <Badge variant="success">Teaching</Badge>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
