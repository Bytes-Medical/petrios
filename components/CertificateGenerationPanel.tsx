'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { generateCertificatesForSession } from '@/app/actions/certificates'

interface CertificateGenerationPanelProps {
  sessionId: string
  attendance: any[]
}

export function CertificateGenerationPanel({
  sessionId,
  attendance,
}: CertificateGenerationPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const presentAttendees = attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE')

  async function handleGenerateCertificates() {
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      await generateCertificatesForSession(sessionId)
      setSuccess(true)
      router.refresh()
      setTimeout(() => setSuccess(false), 5000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate certificates')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      {success && (
        <div className="p-4 border border-green-500 bg-green-50">
          <p className="font-mono text-sm text-green-800">
            Certificates generated successfully! They are now available in the Certificates section.
          </p>
        </div>
      )}

      <div>
        <p className="font-mono text-sm mb-4">
          Generate attendance certificates for all present attendees and teachers. Certificates will include QR codes for verification.
        </p>
        <p className="font-mono text-sm text-gray-600 mb-4">
          Eligible recipients: <strong>{presentAttendees.length}</strong> present/late attendees + teachers
        </p>
      </div>

      <Button
        type="button"
        onClick={handleGenerateCertificates}
        disabled={loading || presentAttendees.length === 0}
      >
        {loading ? 'Generating...' : 'Generate Certificates'}
      </Button>

      {presentAttendees.length === 0 && (
        <p className="font-mono text-sm text-gray-600">
          No present attendees found. Certificates can only be generated for attendees who checked in.
        </p>
      )}
    </div>
  )
}
