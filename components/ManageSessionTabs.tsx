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
import { RecallQuestionsPanel } from './RecallQuestionsPanel'
import { RecallAnalyticsPanel } from './RecallAnalyticsPanel'
import { AudioRecapPanel } from './AudioRecapPanel'
import type { RecallQuestionSet } from '@/lib/db/recall'
import type { AudioRecapMeta } from '@/lib/db/audio-recaps'
import { Button } from './Button'
import {
  LOCATION_TYPE_LABELS,
  type Session,
  type SessionTeacher,
  type TeacherInvitation,
} from '@/lib/types'
import { exactDurationFromDates, formatDuration } from '@/lib/session-duration'
import type { MeetingMode } from '@/lib/meeting/types'
import { ROOM_CLOSE_MINS_AFTER, ROOM_OPEN_MINS_BEFORE } from '@/lib/meeting/window'
import type { SessionDocument } from '@/lib/db/session-documents'
import { SessionDocumentsPanel } from './SessionDocumentsPanel'
import type { AttendanceEvidence, SessionParticipant } from '@/lib/db/attendance'
import { SessionAttendanceManagementPanel } from './SessionAttendanceManagementPanel'
import { LocalDateTime } from './LocalSessionDateTime'

/**
 * Server-resolved Petrios Meet facts for the meeting card (the manage page is
 * moderator-only; nothing here is secret). Built in app/sessions/[id]/manage.
 */
export interface MeetingCardInfo {
  mode: MeetingMode | 'unavailable'
  /** True when every participant needs a Petrios room pass (JaaS, self-hosted JWT). */
  tokenProtected: boolean
  /** Meeting host ('8x8.vc', the self-hosted host, 'meet.jit.si'); null when unavailable. */
  domain: string | null
  /** Room URL that works without a pass (meet.jit.si, open self-hosted); null otherwise. */
  guestUrl: string | null
  /** The configuration problem when mode is 'unavailable'. */
  configurationError: string | null
}

interface ManageSessionTabsProps {
  session: Session
  /** sessionMeetingUrl(session, { kind: 'member' }), resolved on the server. */
  meetingLink: string | null
  meetingCard: MeetingCardInfo
  department: { id: string; name: string }
  teachers: SessionTeacher[]
  departmentMembers: { id: string; email: string | null }[]
  attendance: any[]
  emailHistory: { user_id: string; email_type: string; sent_at: string }[]
  invitations: TeacherInvitation[]
  isPersonal?: boolean
  recallSet?: RecallQuestionSet | null
  /** Server-computed opsEnabled() — OPS_ENABLED=false removes the surface. */
  showAudioRecap?: boolean
  audioRecap?: AudioRecapMeta | null
  documents?: SessionDocument[]
  canUploadDocuments?: boolean
  currentUserId: string
  attendanceGovernance?: {
    participants: SessionParticipant[]
    evidence: AttendanceEvidence[]
  }
}

export function ManageSessionTabs({
  session,
  meetingLink,
  meetingCard,
  department,
  teachers,
  departmentMembers,
  attendance,
  emailHistory,
  invitations,
  isPersonal,
  recallSet = null,
  showAudioRecap = false,
  audioRecap = null,
  documents = [],
  canUploadDocuments = false,
  currentUserId,
  attendanceGovernance = { participants: [], evidence: [] },
}: ManageSessionTabsProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'teachers' | 'attendance' | 'feedback' | 'recall' | 'documents' | 'certificates'>('overview')
  const [editMode, setEditMode] = useState(false)
  const acceptedRegisteredTeacherCount = teachers.filter(
    (teacher) => teacher.status === 'ACCEPTED'
  ).length
  const acceptedExternalTeacherCount = invitations.filter(
    (invitation) => invitation.status === 'ACCEPTED'
  ).length

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'teachers' as const, label: 'Teachers' },
    { id: 'attendance' as const, label: 'Attendance' },
    { id: 'feedback' as const, label: 'Feedback' },
    { id: 'recall' as const, label: 'Recall' },
    { id: 'documents' as const, label: 'Documents' },
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
                    <strong>Date:</strong>{' '}
                    <span className="block sm:inline">
                      <LocalDateTime value={session.date_start} />
                    </span>
                  </p>
                  <p>
                    <strong>Duration:</strong>{' '}
                    {formatDuration(exactDurationFromDates(session.date_start, session.date_end))}
                  </p>
                  <p><strong>Location:</strong> {LOCATION_TYPE_LABELS[session.location_type] || session.location_type}</p>
                  {meetingLink && (
                    <p>
                      <strong>Meeting link:</strong>{' '}
                      <a href={meetingLink} target="_blank" rel="noopener noreferrer" className="underline">
                        {session.location_type !== 'JITSI' ? 'Join Meeting' : 'Open session room page'}
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
              <h2 className="text-xl font-mono font-bold mb-4">
                {session.location_type === 'JITSI' ? 'Petrios Meet Room' : 'Meeting Link'}
              </h2>
              {session.location_type === 'JITSI' ? (
                <PetriosMeetCard card={meetingCard} />
              ) : (
                <UpdateMeetingUrlForm sessionId={session.id} currentUrl={session.teams_meeting_url} />
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
              <h2 className="text-xl font-mono font-bold mb-4">AI-Guided Teacher Report</h2>
              <FeedbackSummaryPanel
                sessionId={session.id}
                invitations={invitations}
                registeredTeacherCount={teachers.length}
              />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Feedback Responses</h2>
              <FeedbackListPanel sessionId={session.id} />
            </Card>
          </div>
        )}

        {activeTab === 'recall' && (
          <div className="space-y-6">
            {showAudioRecap && (
              <Card>
                <h2 className="text-xl font-mono font-bold mb-4">Audio Recap</h2>
                <AudioRecapPanel
                  sessionId={session.id}
                  initialRecap={audioRecap}
                  sourceDocumentCount={documents.filter((document) => document.status === 'AVAILABLE').length}
                />
              </Card>
            )}
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Recall Questions</h2>
              <RecallQuestionsPanel
                // Remount on a new draft: the panel seeds its editable state once,
                // so a set arriving after router.refresh() would otherwise show stale.
                key={
                  recallSet
                    ? `${recallSet.id}:${recallSet.revision}:${recallSet.script_digest ?? ''}:${recallSet.status}`
                    : 'none'
                }
                sessionId={session.id}
                initialSet={recallSet}
                recapScriptDigest={audioRecap?.script_digest}
              />
            </Card>
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Catch-up Analytics</h2>
              <RecallAnalyticsPanel sessionId={session.id} />
            </Card>
          </div>
        )}

        {activeTab === 'attendance' && (
          <Card>
            <h2 className="text-xl font-mono font-bold mb-4">Attendance Governance</h2>
            <SessionAttendanceManagementPanel
              session={session}
              attendance={attendance}
              participants={attendanceGovernance.participants}
              evidence={attendanceGovernance.evidence}
              invitations={invitations}
            />
          </Card>
        )}

        {activeTab === 'documents' && (
          <Card>
            <h2 className="mb-4 font-mono text-xl font-bold">Session Documents</h2>
            <SessionDocumentsPanel
              sessionId={session.id}
              documents={documents}
              canUpload={canUploadDocuments}
              canManage
              currentUserId={currentUserId}
            />
          </Card>
        )}

        {activeTab === 'certificates' && (
          <div className="space-y-6">
            <Card>
              <h2 className="text-xl font-mono font-bold mb-4">Generate Certificates</h2>
              <CertificateGenerationPanel
                sessionId={session.id}
                attendance={attendance}
                attendanceFinalized={session.attendance_phase === 'FINALIZED'}
                registeredTeacherCount={acceptedRegisteredTeacherCount}
                externalTeacherCount={acceptedExternalTeacherCount}
              />
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

function PetriosMeetCard({ card }: { card: MeetingCardInfo }) {
  const windowNote = `The room opens ${ROOM_OPEN_MINS_BEFORE} minutes before the session starts and closes ${ROOM_CLOSE_MINS_AFTER} minutes after it ends.`
  // A raw room link (meet.jit.si, open self-hosted) is not covered by the
  // Petrios window: only the session page enforces it.
  const openRoomWindowNote = `The session page offers the room from ${ROOM_OPEN_MINS_BEFORE} minutes before the start until ${ROOM_CLOSE_MINS_AFTER} minutes after the end; the room link below itself works at any time.`

  if (card.mode === 'unavailable') {
    return (
      <div className="space-y-3 font-mono text-sm">
        <p className="border border-red-500 bg-red-50 px-3 py-2 text-red-800">
          Video rooms are unavailable: {card.configurationError ?? 'the meeting configuration is incomplete.'}
        </p>
        <p className="text-gray-600">
          Participants see a notice instead of the room. Session and invitation links keep
          working once the deployment&apos;s meeting settings are fixed.
        </p>
      </div>
    )
  }

  if (card.mode === 'public') {
    return (
      <div className="space-y-3 font-mono text-sm">
        <p className="text-gray-600">
          This deployment uses the free meet.jit.si service. Rooms open in a new tab, and the
          first person to arrive (usually the teacher) must sign in to Jitsi to start the room.
          Embedded video needs JaaS or a self-hosted Jitsi server. {openRoomWindowNote}
        </p>
        {card.guestUrl ? (
          <p className="break-all border border-black bg-gray-50 px-3 py-2">{card.guestUrl}</p>
        ) : null}
      </div>
    )
  }

  const where =
    card.mode === 'jaas'
      ? '8x8 Jitsi as a Service (JaaS)'
      : `your Jitsi server${card.domain ? ` (${card.domain})` : ''}`

  if (card.tokenProtected) {
    return (
      <div className="space-y-3 font-mono text-sm text-gray-600">
        <p>
          This session uses a built-in Petrios Meet room on {where}. Every participant joins with a
          Petrios room pass, so there is no public room link. Members join from the session page;
          accepted external teachers join from their invitation link.
          {card.mode === 'jaas'
            ? ' Guests without an account cannot join; invite them as teachers.'
            : ' Only hosts moderate if your Jitsi server applies the room pass moderator flag and has guest access and auto-owner turned off (see the self-hosting guide); otherwise the first person to join moderates.'}
        </p>
        <p>
          {card.mode === 'jaas'
            ? 'Recording, live streaming and transcription are off.'
            : 'Room passes ask for recording, live streaming and transcription to be off; your Jitsi server enforces this only if it is set up to.'}{' '}
          {windowNote}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 font-mono text-sm">
      <p className="text-gray-600">
        This session uses a built-in Petrios Meet room on {where}. Members join from the session
        page; share the link below with guests who don&apos;t have an account. Anyone with the
        link can enter this room. {openRoomWindowNote}
      </p>
      {card.guestUrl ? (
        <p className="break-all border border-black bg-gray-50 px-3 py-2">{card.guestUrl}</p>
      ) : null}
    </div>
  )
}
