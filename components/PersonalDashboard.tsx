'use client'

import { useState } from 'react'
import { SessionsPanel } from '@/components/SessionsPanel'
import { FeedbackPanel } from '@/components/FeedbackPanel'
import { AttendancePanel } from '@/components/AttendancePanel'
import { SessionCalendar } from '@/components/SessionCalendar'
import { TeachingAssignmentsPanel } from '@/components/TeachingAssignmentsPanel'
import type {
  SessionWithDetails,
  FeedbackHistoryEntry,
  AttendanceSummary,
  TeachingAssignment,
} from '@/lib/db/trainee-dashboard'
import type { Session } from '@/lib/types'

interface PersonalDashboardProps {
  sessions: { upcoming: SessionWithDetails[]; past: SessionWithDetails[] }
  feedback: FeedbackHistoryEntry[]
  attendance: AttendanceSummary
  teaching: TeachingAssignment[]
  /** Org-wide published sessions for the calendar tab. */
  orgSessions: Session[]
  calendarUrl: string
  /** Deep-link target, e.g. /dashboard?tab=teaching from invitation emails. */
  initialTab?: string
}

type Tab = 'sessions' | 'calendar' | 'teaching' | 'feedback' | 'attendance'

const TAB_KEYS: Tab[] = ['sessions', 'calendar', 'teaching', 'feedback', 'attendance']

export function PersonalDashboard({
  sessions,
  feedback,
  attendance,
  teaching,
  orgSessions,
  calendarUrl,
  initialTab,
}: PersonalDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    TAB_KEYS.includes(initialTab as Tab) ? (initialTab as Tab) : 'sessions'
  )

  const pendingTeaching = teaching.filter((t) => t.status === 'PENDING').length

  const tabs: { key: Tab; label: string; marker?: number }[] = [
    { key: 'sessions', label: 'Sessions' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'teaching', label: 'Teaching', marker: pendingTeaching },
    { key: 'feedback', label: 'Feedback' },
    { key: 'attendance', label: 'Attendance' },
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="flex flex-wrap border-b-2 border-black mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 font-mono text-sm font-bold -mb-[2px] border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-black text-black'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
            {tab.marker ? (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center bg-clay-600 px-1 font-mono text-[10px] font-bold text-white align-middle">
                {tab.marker}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'sessions' && (
        <SessionsPanel upcoming={sessions.upcoming} past={sessions.past} />
      )}
      {activeTab === 'calendar' && (
        <SessionCalendar sessions={orgSessions} subscriptionUrl={calendarUrl} />
      )}
      {activeTab === 'teaching' && (
        <TeachingAssignmentsPanel assignments={teaching} />
      )}
      {activeTab === 'feedback' && <FeedbackPanel entries={feedback} />}
      {activeTab === 'attendance' && <AttendancePanel summary={attendance} />}
    </div>
  )
}
