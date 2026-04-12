'use client'

import { useState } from 'react'
import { SessionsPanel } from '@/components/SessionsPanel'
import { FeedbackPanel } from '@/components/FeedbackPanel'
import { AttendancePanel } from '@/components/AttendancePanel'
import type { SessionWithDetails, FeedbackHistoryEntry, AttendanceSummary } from '@/lib/db/trainee-dashboard'

interface PersonalDashboardProps {
  sessions: { upcoming: SessionWithDetails[]; past: SessionWithDetails[] }
  feedback: FeedbackHistoryEntry[]
  attendance: AttendanceSummary
}

type Tab = 'sessions' | 'feedback' | 'attendance'

const TABS: { key: Tab; label: string }[] = [
  { key: 'sessions', label: 'Sessions' },
  { key: 'feedback', label: 'Feedback' },
  { key: 'attendance', label: 'Attendance' },
]

export function PersonalDashboard({ sessions, feedback, attendance }: PersonalDashboardProps) {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b-2 border-black mb-6">
        {TABS.map((tab) => (
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
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'sessions' && (
        <SessionsPanel upcoming={sessions.upcoming} past={sessions.past} />
      )}
      {activeTab === 'feedback' && <FeedbackPanel entries={feedback} />}
      {activeTab === 'attendance' && <AttendancePanel summary={attendance} />}
    </div>
  )
}
