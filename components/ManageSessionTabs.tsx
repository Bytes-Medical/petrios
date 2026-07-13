'use client'

import { useState } from 'react'
import { Card } from './Card'
import { UpdateMeetingUrlForm } from './UpdateMeetingUrlForm'
import { ManageTeachersPanel } from './ManageTeachersPanel'
import { PublishSessionPanel } from './PublishSessionPanel'
import { CertificateGenerationPanel } from './CertificateGenerationPanel'
import { FeedbackAnalysisPanel } from './FeedbackAnalysisPanel'
import { FeedbackSummaryPanel } from './FeedbackSummaryPanel'
import { DepartmentQRCodePanel } from './DepartmentQRCodePanel'
import { FeedbackListPanel } from './FeedbackListPanel'
import { EditSessionForm } from './EditSessionForm'
import { AuditPanel } from './AuditPanel'
import { ReleaseTeacherFeedbackPanel } from './ReleaseTeacherFeedbackPanel'
import { RecallQuestionsPanel } from './RecallQuestionsPanel'
import { RecallAnalyticsPanel } from './RecallAnalyticsPanel'
import type { RecallQuestionSet } from '@/lib/db/recall'
import { Button } from './Button'
import { LOCATION_TYPE_LABELS, type Session, type TeacherInvitation } from '@/lib/types'
import { exactDurationFromDates, formatDuration } from '@/lib/session-duration'
import { sessionMeetingUrl } from '@/lib/jitsi'

interface ManageSessionTabsProps {
  session: Session
  department: { id: string; name: string }
  teachers: { id: string; user_id: string }[]
  departmentMembers: { id: string; email: string | null }[]
  attendance: any[]
  emailHistory: { user_id: string; email_type: string; sent_at: string }[]
  invitations: TeacherInvitation[]
  isPersonal?: boolean
  recallSet?: RecallQuestionSet | null
}

export function ManageSessionTabs({
  session,
  department,
  teachers,
  departmentMembers,
  attendance,
  emailHistory,
  invitations,
  isPersonal,
  recallSet = null,
}: ManageSessionTabsProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'meeting' | 'teachers' | 'feedback' | 'recall' | 'audit' | 'certificates'>('overview')
  const meetingUrl = sessionMeetingUrl(session)
  const [editMode, setEditMode] = useState(false)

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'meeting' as const, label: 'Meeting Link' },
    { id: 'teachers' as const, label: 'Teachers' },
    { id: 'feedback' as const, label: 'Feedback' },
    { id: 'recall' as const, label: 'Recall' },
    { id: 'audit' as const, label: 'Audit' },
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
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-mono font-bold">Details</h2>
                {!editMode && (
                  <Button variant="secondary" onClick={() => setEditMode(true)}>
                    Edit
                  </Button>
                )}
              </div>
              {editMode ? (
                <EditSessionForm
                  session={session}
                  onCancel={() => setEditMode(false)}
                  onSave={() => setEditMode(false)}
                />
              ) : (
                <div className="space-y-2 font-mono text-sm">
                  <p><strong>Title:</strong> {session.title}</p>
                  <p className="break-words">
                    <strong>Date:</strong> <span className="block sm:inline">{new Date(session.date_start).toLocaleString('en-GB')}</span>
                  </p>
                  <p>
                    <strong>Duration:</strong>{' '}
                    {formatDuration(exactDurationFromDates(session.date_start, session.date_end))}
                  </p>
                  <p><strong>Location:</strong> {LOCATION_TYPE_LABELS[session.location_type] || session.location_type}</p>
                  {meetingUrl && (
                    <p>
                      <strong>Meeting link:</strong>{' '}
                      <a href={meetingUrl} target="_blank" rel="noopener noreferrer" className="underline">
                        {session.location_type === 'JITSI' ? 'Open Petrios Meet room' : 'Join Meeting'}
                      </a>
                    </p>
                  )}
                  <p><strong>Status:</strong> {session.status}</p>
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
              )}
            </Card>

            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Publish Session</h2>
              <PublishSessionPanel
                sessionId={session.id}
                currentStatus={session.status}
                dateEnd={session.date_end}
                isPersonal={isPersonal}
              />
            </Card>
          </div>
        )}

        {activeTab === 'meeting' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">
              {session.location_type === 'JITSI' ? 'Petrios Meet Room' : 'Update Meeting Link'}
            </h2>
            {session.location_type === 'JITSI' ? (
              <div className="space-y-3 font-mono text-sm">
                <p className="text-gray-600">
                  This session uses a built-in Petrios Meet video room — no link to
                  paste. Members join from the session page; share the link
                  below with external guests who don&apos;t have an account.
                </p>
                <p className="break-all border border-black bg-gray-50 px-3 py-2">
                  {meetingUrl}
                </p>
              </div>
            ) : (
              <UpdateMeetingUrlForm sessionId={session.id} currentUrl={session.teams_meeting_url} />
            )}
          </Card>
        )}

        {activeTab === 'teachers' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Manage Teachers</h2>
            <ManageTeachersPanel
              sessionId={session.id}
              currentTeachers={teachers}
              departmentMembers={departmentMembers}
              emailHistory={emailHistory}
              invitations={invitations}
            />
          </Card>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Department QR Code</h2>
              <DepartmentQRCodePanel departmentId={department.id} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Feedback Analysis</h2>
              <FeedbackAnalysisPanel sessionId={session.id} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">AI Summary</h2>
              <FeedbackSummaryPanel sessionId={session.id} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Feedback Responses</h2>
              <FeedbackListPanel sessionId={session.id} />
            </Card>
          </div>
        )}

        {activeTab === 'recall' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Recall Questions</h2>
              <RecallQuestionsPanel sessionId={session.id} initialSet={recallSet} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Retention Analytics</h2>
              <RecallAnalyticsPanel sessionId={session.id} />
            </Card>
          </div>
        )}

        {activeTab === 'audit' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Attendance Audit</h2>
            <p className="font-mono text-sm text-gray-600 mb-4">
              Feedback submissions serve as attendance records. Each entry below represents a confirmed attendee.
            </p>
            <AuditPanel sessionId={session.id} />
          </Card>
        )}

        {activeTab === 'certificates' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Generate Certificates</h2>
              <CertificateGenerationPanel sessionId={session.id} attendance={attendance} />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Release Feedback to Teachers</h2>
              <ReleaseTeacherFeedbackPanel
                sessionId={session.id}
                invitations={invitations}
                registeredTeacherCount={teachers.length}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
