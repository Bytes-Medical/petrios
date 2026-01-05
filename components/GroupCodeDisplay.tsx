'use client'

import { useState, useEffect } from 'react'
import { Button } from './Button'
import { generateGroupCode } from '@/app/actions/attendance-evidence'
import QRCode from 'qrcode'
import { useRouter } from 'next/navigation'

interface GroupCodeDisplayProps {
  sessionId: string
  groupCodeVersion: number | null
  groupCodeExpiresAt: string | null
  groupCodeEnabled: boolean
}

export function GroupCodeDisplay({
  sessionId,
  groupCodeVersion,
  groupCodeExpiresAt,
  groupCodeEnabled,
}: GroupCodeDisplayProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [currentCode, setCurrentCode] = useState<string | null>(null)

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const checkInUrl = `${baseUrl}/sessions/${sessionId}/checkin?v=${groupCodeVersion || 0}`

  useEffect(() => {
    if (groupCodeVersion !== null && groupCodeVersion > 0) {
      generateQRCode()
      // Fetch the code for this version
      fetchCode()
    }
  }, [groupCodeVersion, checkInUrl])

  async function fetchCode() {
    if (groupCodeVersion === null || groupCodeVersion === 0) return
    
    try {
      // Generate code client-side using same deterministic algorithm
      // In production, you'd fetch from server or use the RPC
      const response = await fetch(`/api/sessions/${sessionId}/group-code/current`)
      if (response.ok) {
        const data = await response.json()
        setCurrentCode(data.code)
      }
    } catch (err) {
      // If fetch fails, code will be generated on server
      console.error('Failed to fetch code:', err)
    }
  }

  async function generateQRCode() {
    try {
      const dataUrl = await QRCode.toDataURL(checkInUrl, {
        width: 200,
        margin: 2,
      })
      setQrCodeDataUrl(dataUrl)
    } catch (err) {
      console.error('Failed to generate QR code:', err)
    }
  }

  async function handleGenerateCode() {
    setLoading(true)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/group-code`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to generate group code')
      }
      const result = await response.json()
      setCurrentCode(result.code)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to generate group code')
    } finally {
      setLoading(false)
    }
  }

  const isExpired = groupCodeExpiresAt && new Date() > new Date(groupCodeExpiresAt)
  const hasCode = groupCodeVersion !== null && groupCodeVersion > 0

  if (!groupCodeEnabled) {
    return null
  }

  return (
    <div className="space-y-4">
      {!hasCode ? (
        <div>
          <p className="font-mono text-sm text-gray-600 mb-3">
            Generate a group code to allow attendees to check in together.
          </p>
          <Button onClick={handleGenerateCode} disabled={loading}>
            {loading ? 'Generating...' : 'Start Session & Generate Code'}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {isExpired && (
            <div className="p-3 border border-yellow-500 bg-yellow-50">
              <p className="font-mono text-xs text-yellow-800">Group code has expired</p>
            </div>
          )}
          
          <div className="p-4 border border-black">
            <p className="font-mono text-sm text-gray-600 mb-2">Group Code (Version {groupCodeVersion})</p>
            <p className="text-3xl font-mono font-bold mb-2">{currentCode || 'XXXXXX'}</p>
            {groupCodeExpiresAt && (
              <p className="font-mono text-xs text-gray-600">
                Expires: {new Date(groupCodeExpiresAt).toLocaleString()}
              </p>
            )}
          </div>

          {qrCodeDataUrl && (
            <div className="flex flex-col items-center">
              <img src={qrCodeDataUrl} alt="Group Check-in QR Code" className="border border-black p-4 bg-white" />
              <p className="font-mono text-xs text-gray-600 mt-2">Scan to check in</p>
            </div>
          )}

          <div>
            <p className="font-mono text-sm text-gray-600 mb-2">Check-in Link:</p>
            <input
              type="text"
              value={checkInUrl}
              readOnly
              className="w-full px-3 py-2 border border-black font-mono text-sm bg-white"
            />
          </div>

          <Button onClick={handleGenerateCode} disabled={loading} variant="secondary">
            {loading ? 'Regenerating...' : 'Regenerate Code'}
          </Button>
        </div>
      )}
    </div>
  )
}
