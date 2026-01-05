'use client'

import { useState } from 'react'
import { Card } from './Card'
import { UpdateMeetingUrlForm } from './UpdateMeetingUrlForm'
import { ManageTeachersPanel } from './ManageTeachersPanel'
import { PublishSessionPanel } from './PublishSessionPanel'
import { AttendanceTrackingPanel } from './AttendanceTrackingPanel'
import { CertificateGenerationPanel } from './CertificateGenerationPanel'
import { FeedbackAnalysisPanel } from './FeedbackAnalysisPanel'
import { FeedbackQRCodePanel } from './FeedbackQRCodePanel'
import { CheckInButton } from './CheckInButton'
import { GroupCodeCheckIn } from './GroupCodeCheckIn'
import { GroupCodeDisplay } from './GroupCodeDisplay'
import type { Session } from '@/lib/types'

interface ManageSessionTabsProps {
  session: Session
  department: { id: string; name: string }
  teachers: { id: string; user_id: string }[]
  departmentMembers: { id: string; email: string | null }[]
  attendance: any[]
  isAttendanceLocked?: boolean
  currentUserId: string | null
  hasCheckedIn: boolean
  isCheckInWindow: boolean
  checkinOpenMins: number
  checkinCloseMins: number
}

export function ManageSessionTabs({
  session,
  department,
  teachers,
  departmentMembers,
  attendance,
  isAttendanceLocked = false,
  currentUserId,
  hasCheckedIn,
  isCheckInWindow,
  checkinOpenMins,
  checkinCloseMins,
}: ManageSessionTabsProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'checkin' | 'meeting' | 'teachers' | 'attendance' | 'feedback' | 'certificates'>('overview')

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'checkin' as const, label: 'Check-in' },
    { id: 'meeting' as const, label: 'Meeting Link' },
    { id: 'teachers' as const, label: 'Teachers' },
    { id: 'attendance' as const, label: 'Attendance' },
    { id: 'feedback' as const, label: 'Feedback' },
    { id: 'certificates' as const, label: 'Certificates' },
  ]

  return (
    <div>
      <div className="border-b border-black mb-6">
        <div className="flex flex-wrap gap-2 sm:gap-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 font-mono text-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-black font-bold'
                  : 'border-transparent hover:border-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Details</h2>
              <div className="space-y-2 font-mono text-sm">
                <p className="break-words">
                  <strong>Date:</strong> <span className="block sm:inline">{new Date(session.date_start).toLocaleString()}</span> - <span className="block sm:inline">{new Date(session.date_end).toLocaleString()}</span>
                </p>
                <p><strong>Location:</strong> {session.location_type}</p>
                {session.teams_meeting_url && (
                  <p>
                    <strong>Teams URL:</strong>{' '}
                    <a href={session.teams_meeting_url} target="_blank" rel="noopener noreferrer" className="underline">
                      Join Meeting
                    </a>
                  </p>
                )}
                <p><strong>Status:</strong> {session.status}</p>
                {session.capacity && <p><strong>Capacity:</strong> {session.capacity}</p>}
                {session.tags && session.tags.length > 0 && (
                  <p><strong>Tags:</strong> {session.tags.join(', ')}</p>
                )}
                {session.description && (
                  <div className="mt-4 pt-4 border-t border-gray-300">
                    <p><strong>Description:</strong></p>
                    <p className="mt-2 whitespace-pre-wrap">{session.description}</p>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Publish Session</h2>
              <PublishSessionPanel sessionId={session.id} currentStatus={session.status} />
            </Card>
          </div>
        )}

        {activeTab === 'checkin' && session.status === 'PUBLISHED' && (
          <div className="space-y-6">
            {session.group_code_enabled && (
              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Group Code</h2>
                <GroupCodeDisplay
                  sessionId={session.id}
                  groupCodeVersion={session.group_code_version}
                  groupCodeExpiresAt={session.group_code_expires_at}
                  groupCodeEnabled={session.group_code_enabled}
                />
              </Card>
            )}

            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Check In</h2>
              {isCheckInWindow && !hasCheckedIn ? (
                <div className="space-y-4">
                  <CheckInButton sessionId={session.id} />
                  {session.group_code_enabled && session.group_code_version && session.group_code_version > 0 && (
                    <div className="pt-4 border-t border-gray-300">
                      <GroupCodeCheckIn
                        sessionId={session.id}
                        groupCodeVersion={session.group_code_version}
                      />
                    </div>
                  )}
                </div>
              ) : hasCheckedIn ? (
                <p className="font-mono text-sm">You have checked in.</p>
              ) : (
                <p className="font-mono text-sm text-gray-600">
                  Check-in window: {checkinOpenMins} minutes before to {checkinCloseMins} minutes after session start.
                </p>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'meeting' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Update Meeting Link</h2>
            <UpdateMeetingUrlForm sessionId={session.id} currentUrl={session.teams_meeting_url} />
          </Card>
        )}

        {activeTab === 'teachers' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Manage Teachers</h2>
            <ManageTeachersPanel
              sessionId={session.id}
              currentTeachers={teachers}
              departmentMembers={departmentMembers}
            />
          </Card>
        )}

        {activeTab === 'attendance' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Track Attendance</h2>
            <AttendanceTrackingPanel 
              sessionId={session.id} 
              attendance={attendance}
              isLocked={isAttendanceLocked}
            />
          </Card>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Feedback Link & QR Code</h2>
              <FeedbackQRCodePanel sessionId={session.id} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Feedback Analysis</h2>
              <FeedbackAnalysisPanel sessionId={session.id} />
            </Card>
          </div>
        )}

        {activeTab === 'certificates' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Generate Certificates</h2>
            <CertificateGenerationPanel sessionId={session.id} attendance={attendance} />
          </Card>
        )}
      </div>
    </div>
  )
}
