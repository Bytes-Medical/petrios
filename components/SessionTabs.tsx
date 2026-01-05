'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from './Card'
import { AttendanceList } from './AttendanceList'
import { Button } from './Button'
import { generateCertificatesForSession } from '@/app/actions/certificates'
import type { Session } from '@/lib/types'

interface SessionTabsProps {
  session: Session
  sessionId: string
  teachers: any[]
  attendance: any[]
}

export function SessionTabs({
  session,
  sessionId,
  teachers,
  attendance,
}: SessionTabsProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'attendance'>('attendance')
  const [generatingCertificates, setGeneratingCertificates] = useState(false)

  async function handleGenerateCertificates() {
    setGeneratingCertificates(true)
    try {
      await generateCertificatesForSession(sessionId)
      router.refresh()
    } catch (error) {
      console.error('Failed to generate certificates:', error)
      alert('Failed to generate certificates. Please try again.')
    } finally {
      setGeneratingCertificates(false)
    }
  }

  return (
    <div>
      <div>
        {activeTab === 'attendance' && (
          <Card>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-xl font-mono font-bold">Attendance</h2>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <a
                  href={`/api/sessions/${sessionId}/attendance/export`}
                  className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50 text-center"
                >
                  Export CSV
                </a>
                <Button 
                  type="button" 
                  variant="secondary" 
                  onClick={handleGenerateCertificates}
                  disabled={generatingCertificates}
                >
                  {generatingCertificates ? 'Generating...' : 'Generate Certificates'}
                </Button>
              </div>
            </div>
            <AttendanceList
              sessionId={sessionId}
              attendance={attendance}
              teachers={teachers}
            />
          </Card>
        )}
      </div>
    </div>
  )
}
