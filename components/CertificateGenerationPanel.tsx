'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { useToast } from './ToastProvider'
import { generateCertificatesForSession } from '@/app/actions/certificates'

interface CertificateGenerationPanelProps {
  sessionId: string
  attendance: any[]
  attendanceFinalized: boolean
}

export function CertificateGenerationPanel({
  sessionId,
  attendance,
  attendanceFinalized,
}: CertificateGenerationPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  const presentAttendees = attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE')

  async function handleGenerateCertificates() {
    setLoading(true)

    try {
      const result = await generateCertificatesForSession(sessionId)
      showToast(
        result.failures.length > 0
          ? {
              variant: 'error',
              title: 'Some certificates could not be generated',
              description: `${result.issuedCount} issued, ${result.existingCount} already existed, ${result.failures.length} failed. Attendance eligibility was not bypassed.`,
            }
          : {
              variant: 'success',
              title: 'Certificates processed',
              description: `${result.issuedCount} issued and ${result.existingCount} already existed.`,
            }
      )
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Certificate generation failed',
        description: err instanceof Error ? err.message : 'Failed to generate certificates',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-sm mb-4">
          Generate attendance certificates for all present attendees and teachers. Certificates will include QR codes for verification.
        </p>
        <p className="font-mono text-sm text-gray-600 mb-4">
          Eligible recipients: <strong>{presentAttendees.length}</strong> finalized present/late attendees. Accepted teachers also require finalized attendance.
        </p>
      </div>

      <Button
        type="button"
        onClick={handleGenerateCertificates}
        disabled={loading || presentAttendees.length === 0 || !attendanceFinalized}
      >
        {loading ? 'Generating...' : 'Generate Certificates'}
      </Button>

      {presentAttendees.length === 0 && (
        <p className="font-mono text-sm text-gray-600">
          No present attendees found. Certificates can only be generated for attendees who checked in.
        </p>
      )}
      {!attendanceFinalized && (
        <p className="font-mono text-sm text-amber-700">
          Attendance must be finalized before certificates can be generated.
        </p>
      )}
    </div>
  )
}
