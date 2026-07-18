'use client'

import { Badge } from './Badge'
import { Button } from './Button'
import { useToast } from './ToastProvider'
import { updateSessionStatus } from '@/app/actions/sessions'
import { useActionWithRefresh } from '@/hooks/useActionWithRefresh'
import { getSessionPublishBlockReason } from '@/lib/session-validation'
import type { SessionStatus } from '@/lib/types'

interface PublishSessionPanelProps {
  sessionId: string
  currentStatus: SessionStatus
  dateEnd: string
  isPersonal?: boolean
}

export function PublishSessionPanel({
  sessionId,
  currentStatus,
  dateEnd,
  isPersonal,
}: PublishSessionPanelProps) {
  const { showToast } = useToast()
  const { isPending: loading, run } = useActionWithRefresh()
  const publishBlockedReason = getSessionPublishBlockReason(dateEnd)

  function handleStatusChange(newStatus: SessionStatus) {
    if (newStatus === 'PUBLISHED' && publishBlockedReason) {
      showToast({
        variant: 'error',
        title: 'Cannot publish session',
        description: publishBlockedReason,
      })
      return
    }

    run(async () => {
      try {
        await updateSessionStatus(sessionId, newStatus)
        showToast({
          variant: 'success',
          title: 'Session updated',
          description: `Session status is now ${newStatus}.`,
        })
      } catch (err) {
        showToast({
          variant: 'error',
          title: 'Failed to update session',
          description: err instanceof Error ? err.message : 'Failed to update status',
        })
        throw err
      }
    })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-sm mb-4 flex items-center gap-2">
          Current status:{' '}
          <Badge
            variant={
              currentStatus === 'PUBLISHED'
                ? 'success'
                : currentStatus === 'CANCELLED'
                  ? 'danger'
                  : 'default'
            }
          >
            {currentStatus}
          </Badge>
        </p>
        <p className="font-mono text-sm text-gray-600 mb-4">
          {isPersonal
            ? 'Draft sessions stay private while you prepare. Publish when the session is ready to run.'
            : 'Published sessions are visible to all department members. Draft sessions are only visible to moderators.'}
        </p>
        {publishBlockedReason ? (
          <p className="font-mono text-sm text-gray-600">
            This session has already ended, so it can stay as draft or be cancelled, but it can no longer be published.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={() => handleStatusChange('PUBLISHED')}
          pending={loading}
          disabled={currentStatus === 'PUBLISHED' || !!publishBlockedReason}
        >
          {loading ? 'Updating...' : 'Publish Session'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => handleStatusChange('DRAFT')}
          pending={loading}
          disabled={currentStatus === 'DRAFT'}
        >
          {loading ? 'Updating...' : 'Unpublish (Draft)'}
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={() => handleStatusChange('CANCELLED')}
          pending={loading}
          disabled={currentStatus === 'CANCELLED'}
        >
          {loading ? 'Updating...' : 'Cancel Session'}
        </Button>
      </div>
    </div>
  )
}
