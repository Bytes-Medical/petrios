import Link from 'next/link'
import type { Session } from '@/lib/types'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { DeleteSessionButton } from '@/components/DeleteSessionButton'
import { LocalDateTime } from '@/components/LocalSessionDateTime'

export type DepartmentSessionCardSession = Pick<
  Session,
  'id' | 'title' | 'description' | 'date_start' | 'location_type' | 'status'
>

/**
 * One row of a department session list. Shared by the upcoming and previous
 * session pages so both render identical cards and moderator actions.
 */
export function DepartmentSessionCard({
  session,
  canManage,
}: {
  session: DepartmentSessionCardSession
  canManage: boolean
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-mono font-bold mb-2 break-words">
            <Link href={`/sessions/${session.id}`} className="hover:underline">
              {session.title}
            </Link>
          </h2>
          {session.description && (
            <p className="font-mono text-sm text-gray-600 mb-2 break-words">{session.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-2 font-mono text-sm">
            <span>
              <LocalDateTime value={session.date_start} />
            </span>
            <span className="text-gray-600">{session.location_type}</span>
            <span className={`px-2 py-1 border ${
              session.status === 'PUBLISHED' ? 'border-black' : 'border-gray-400'
            }`}>
              {session.status}
            </span>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-shrink-0 gap-2">
            <Link href={`/sessions/${session.id}/manage`} className="flex-1 sm:flex-none">
              <Button variant="secondary" className="w-full text-xs sm:text-sm">
                Manage
              </Button>
            </Link>
            <DeleteSessionButton sessionId={session.id} />
          </div>
        )}
      </div>
    </Card>
  )
}
