'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { approveDepartmentJoinRequest, rejectDepartmentJoinRequest } from '@/app/actions/join-requests'

interface JoinRequest {
  id: string
  user_id: string
  user_email: string
  requested_role: string
  departments?: {
    id: string
    name: string
  } | null
  organizations?: {
    id: string
    name: string
  } | null
  created_at: string
}

interface JoinRequestsPanelProps {
  joinRequests: JoinRequest[]
}

export function JoinRequestsPanel({ joinRequests }: JoinRequestsPanelProps) {
  const router = useRouter()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove(requestId: string) {
    setLoadingId(requestId)
    setError(null)
    try {
      await approveDepartmentJoinRequest(requestId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve request')
    } finally {
      setLoadingId(null)
    }
  }

  async function handleReject(requestId: string) {
    setLoadingId(requestId)
    setError(null)
    try {
      await rejectDepartmentJoinRequest(requestId)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject request')
    } finally {
      setLoadingId(null)
    }
  }

  if (joinRequests.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">No pending join requests.</p>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <ul className="space-y-3">
        {joinRequests.map(request => (
          <li key={request.id} className="border border-black p-3">
            <div className="font-mono text-sm mb-3">
              <div className="break-words">{request.user_email || request.user_id}</div>
              <div className="text-gray-600">
                Requested role: {request.requested_role}
              </div>
              {request.departments?.name && (
                <div className="text-gray-600">
                  Department: {request.departments.name}
                </div>
              )}
              {request.organizations?.name && (
                <div className="text-gray-600">
                  Organization: {request.organizations.name}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                onClick={() => handleApprove(request.id)}
                disabled={loadingId === request.id}
                className="w-full sm:w-auto"
              >
                Approve
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleReject(request.id)}
                disabled={loadingId === request.id}
                className="w-full sm:w-auto"
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
