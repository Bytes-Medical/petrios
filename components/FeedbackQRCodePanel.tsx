'use client'

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'

interface FeedbackQRCodePanelProps {
  sessionId: string
}

export function FeedbackQRCodePanel({ sessionId }: FeedbackQRCodePanelProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const feedbackUrl = `${baseUrl}/sessions/${sessionId}/feedback`

  useEffect(() => {
    async function generateQRCode() {
      try {
        const dataUrl = await QRCode.toDataURL(feedbackUrl, {
          width: 300,
          margin: 2,
        })
        setQrCodeDataUrl(dataUrl)
      } catch (err) {
        console.error('Failed to generate QR code:', err)
      } finally {
        setLoading(false)
      }
    }
    generateQRCode()
  }, [feedbackUrl])

  function copyToClipboard() {
    navigator.clipboard.writeText(feedbackUrl)
    alert('Feedback link copied to clipboard!')
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-sm text-gray-600 mb-2">
          Share this link or QR code with attendees to collect feedback.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-start">
          <input
            type="text"
            value={feedbackUrl}
            readOnly
            className="flex-1 px-3 py-2 border border-black font-mono text-sm bg-white"
          />
          <button
            onClick={copyToClipboard}
            className="px-4 py-2 border border-black bg-white text-black font-mono text-sm hover:bg-gray-50 whitespace-nowrap"
          >
            Copy Link
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center">
        {loading ? (
          <p className="font-mono text-sm text-gray-600">Generating QR code...</p>
        ) : qrCodeDataUrl ? (
          <>
            <img src={qrCodeDataUrl} alt="Feedback QR Code" className="border border-black p-4 bg-white" />
            <p className="font-mono text-xs text-gray-600 mt-2">
              Scan with any QR code reader to open feedback form
            </p>
          </>
        ) : (
          <p className="font-mono text-sm text-red-600">Failed to generate QR code</p>
        )}
      </div>
    </div>
  )
}
