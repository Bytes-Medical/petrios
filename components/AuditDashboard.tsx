'use client'

import { useMemo, useState } from 'react'
import { AuditSessionsTable } from './AuditSessionsTable'
import { AuditCertificateTable } from './AuditCertificateTable'
import { EquityPanel } from './EquityPanel'
import { AuditMemberPanel } from './AuditMemberPanel'
import { Button } from './Button'
import { Input } from './Input'
import { generateAuditReportPDF } from '@/app/actions/audit'
import type { AuditPageData } from '@/app/actions/audit'

interface AuditDashboardProps {
  data: AuditPageData
}

export function AuditDashboard({ data }: AuditDashboardProps) {
  const [activeTab, setActiveTab] = useState<'sessions' | 'certificates' | 'members' | 'equity'>('sessions')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [downloading, setDownloading] = useState(false)

  const filteredSessions = useMemo(() => {
    return data.recentSessions.filter((s) => {
      if (dateFrom && s.dateStart < dateFrom) return false
      if (dateTo && s.dateStart > dateTo + 'T23:59:59') return false
      return true
    })
  }, [data.recentSessions, dateFrom, dateTo])

  const filteredStats = useMemo(() => {
    if (!dateFrom && !dateTo) return data.stats

    const totalSessions = filteredSessions.length
    const totalPresent = filteredSessions.reduce((sum, s) => sum + s.attendancePresent, 0)
    const totalAttendees = filteredSessions.reduce((sum, s) => sum + s.attendanceTotal, 0)
    const avgAttendance = totalAttendees > 0 ? Math.round((totalPresent / totalAttendees) * 100) : 0

    const ratingSessions = filteredSessions.filter((s) => s.averageRating !== null)
    const avgRating = ratingSessions.length > 0
      ? Math.round((ratingSessions.reduce((sum, s) => sum + (s.averageRating ?? 0), 0) / ratingSessions.length) * 10) / 10
      : 0

    const totalCerts = filteredSessions.reduce((sum, s) => sum + s.certificatesIssued, 0)

    return {
      totalSessions,
      averageAttendanceRate: avgAttendance,
      averageFeedbackRating: avgRating,
      certificatesIssued: totalCerts,
    }
  }, [data.stats, filteredSessions, dateFrom, dateTo])

  const tabs = [
    { id: 'sessions' as const, label: 'Sessions' },
    { id: 'certificates' as const, label: 'Certificates' },
    { id: 'members' as const, label: 'Members' },
    { id: 'equity' as const, label: 'Equity' },
  ]

  async function handleDownloadReport() {
    setDownloading(true)
    try {
      const { base64, filename } = await generateAuditReportPDF(dateFrom || undefined, dateTo || undefined)
      const blob = new Blob(
        [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
        { type: 'application/pdf' }
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to generate report:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Date Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex gap-4 flex-1">
          <Input
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => { setDateFrom(''); setDateTo('') }}
              className="self-end pb-2 font-mono text-xs underline text-gray-500"
            >
              Clear
            </button>
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleDownloadReport}
          disabled={downloading}
        >
          {downloading ? 'Generating...' : 'Download Report (PDF)'}
        </Button>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Sessions" value={filteredStats.totalSessions} />
        <StatCard
          label="Attendance Rate"
          value={`${filteredStats.averageAttendanceRate}%`}
        />
        <StatCard
          label="Avg Rating"
          value={filteredStats.averageFeedbackRating > 0 ? `${filteredStats.averageFeedbackRating}/5` : '—'}
        />
        <StatCard label="Certificates" value={filteredStats.certificatesIssued} />
      </div>

      {/* Tabs */}
      <div className="border-b border-black mb-6">
        <div className="flex gap-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 font-mono text-sm whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-black font-bold'
                  : 'border-transparent text-gray-500 hover:text-black'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'sessions' && (
        <AuditSessionsTable sessions={filteredSessions} />
      )}
      {activeTab === 'certificates' && (
        <AuditCertificateTable certificates={data.certificates} />
      )}
      {activeTab === 'members' && (
        <AuditMemberPanel summary={data.memberSummary} members={data.memberDetails} />
      )}
      {activeTab === 'equity' && <EquityPanel members={data.memberDetails} />}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-black p-4">
      <p className="font-mono text-2xl font-bold">{value}</p>
      <p className="font-mono text-xs text-gray-600">{label}</p>
    </div>
  )
}
