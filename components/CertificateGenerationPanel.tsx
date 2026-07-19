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
  registeredTeacherCount: number
  externalTeacherCount: number
}

export function CertificateGenerationPanel({
  sessionId,
  attendance,
  attendanceFinalized,
  registeredTeacherCount,
  externalTeacherCount,
}: CertificateGenerationPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  const presentAttendees = attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE')
  const acceptedTeacherCount = registeredTeacherCount + externalTeacherCount
  const hasEligibleRecipients = presentAttendees.length > 0 || acceptedTeacherCount > 0

  async function handleGenerateCertificates() {
    setLoading(true)

    try {
      const result = await generateCertificatesForSession(sessionId)
      showToast(
        result.failures.length > 0
          ? {
              variant: 'error',
              title: 'Some certificates could not be generated',
              description: `${result.issuedCount} issued, ${result.existingCount} already existed, ${result.failures.length} failed. Certificate eligibility was not bypassed.`,
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
          Generate teaching certificates for accepted teachers and attendance certificates for
          finalized present/late attendees. Certificates include QR verification.
        </p>
        <p className="font-mono text-sm text-gray-600 mb-4">
          Present/late attendance records: <strong>{presentAttendees.length}</strong>. Accepted teachers:{' '}
          <strong>{acceptedTeacherCount}</strong> ({registeredTeacherCount} registered,{' '}
          {externalTeacherCount} external). Registered teachers receive a teaching certificate in
          their account; external teachers receive it as a PDF email attachment.
        </p>
      </div>

      <Button
        type="button"
        onClick={handleGenerateCertificates}
        disabled={loading || !hasEligibleRecipients || !attendanceFinalized}
      >
        {loading ? 'Generating and delivering...' : 'Generate Certificates'}
      </Button>

      {!hasEligibleRecipients && (
        <p className="font-mono text-sm text-gray-600">
          No eligible recipients found. Accept a teacher assignment or mark an attendee present/late.
        </p>
      )}
      {hasEligibleRecipients && presentAttendees.length === 0 && acceptedTeacherCount > 0 && (
        <p className="font-mono text-sm text-gray-600">
          No attendees are eligible, but accepted teachers can still receive teaching certificates.
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
