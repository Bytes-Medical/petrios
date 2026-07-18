'use client'

import { useState } from 'react'
import { Card } from './Card'
import { AttendanceList } from './AttendanceList'
import type { Session } from '@/lib/types'
import type { SessionDocument } from '@/lib/db/session-documents'
import { SessionDocumentsPanel } from './SessionDocumentsPanel'
import { SessionCheckInPanel } from './SessionCheckInPanel'

interface SessionTabsProps {
  session: Session
  sessionId: string
  teachers: any[]
  attendance: any[]
  documents: SessionDocument[]
  canUploadDocuments: boolean
  currentUserId: string
  serverNow: string
}

export function SessionTabs({
  session,
  sessionId,
  teachers,
  attendance,
  documents,
  canUploadDocuments,
  currentUserId,
  serverNow,
}: SessionTabsProps) {
  const [activeTab, setActiveTab] = useState<'attendance' | 'documents'>('attendance')

  return (
    <div>
      <div className="mb-6 flex gap-3 border-b border-black">
        {(['attendance', 'documents'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-3 py-2 font-mono text-sm capitalize ${activeTab === tab ? 'border-black font-bold' : 'border-transparent'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div>
        {activeTab === 'attendance' && (
          <Card>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-mono font-bold">Attendance</h2>
            </div>
            <SessionCheckInPanel session={session} serverNow={serverNow} />
            <AttendanceList
              sessionId={sessionId}
              attendance={attendance}
              teachers={teachers}
              readOnly
            />
          </Card>
        )}
        {activeTab === 'documents' && (
          <Card>
            <h2 className="mb-4 font-mono text-xl font-bold">Documents</h2>
            <SessionDocumentsPanel
              sessionId={sessionId}
              documents={documents}
              canUpload={canUploadDocuments}
              currentUserId={currentUserId}
            />
          </Card>
        )}
      </div>
    </div>
  )
}
