'use client'

import { useState } from 'react'
import { verifyTeachingRecord, type RecordVerification } from '@/app/actions/federation'
import { Badge } from './Badge'
import { Button } from './Button'

/** Paste-and-verify for portable teaching records from any instance. */
export function RecordVerifyForm() {
  const [json, setJson] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RecordVerification | null>(null)

  async function handleVerify() {
    setBusy(true)
    try {
      setResult(await verifyTeachingRecord(json))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={10}
        placeholder='Paste a teaching record JSON ({"format":"petrios-record/v1", …})'
        className="w-full border border-black px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-clay-600"
      />
      <Button onClick={handleVerify} disabled={busy || !json.trim()}>
        {busy ? 'Verifying…' : 'Verify record'}
      </Button>

      {result && (
        <div className="border border-black p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-lg font-bold">
              {result.valid ? 'Signature valid' : 'Not valid'}
            </p>
            <Badge variant={result.valid ? 'success' : 'danger'}>
              {result.valid ? 'verified' : 'failed'}
            </Badge>
          </div>
          {!result.valid && (
            <p className="mt-2 font-mono text-sm text-red-700">{result.reason}</p>
          )}
          {result.valid && (
            <div className="mt-3 space-y-1 font-mono text-sm">
              <p><strong>Subject:</strong> {result.subjectName}</p>
              <p><strong>Issuer:</strong> {result.issuer}</p>
              <p>
                <strong>Issued:</strong>{' '}
                {result.issuedAt ? new Date(result.issuedAt).toLocaleString('en-GB') : '—'}
              </p>
              <p><strong>Attendance entries:</strong> {result.attendanceCount}</p>
              {result.certificates && result.certificates.length > 0 && (
                <p className="break-all">
                  <strong>Certificate codes:</strong> {result.certificates.join(', ')}
                </p>
              )}
              <p className="pt-2 text-xs text-gray-600">
                {result.issuerKeyConfirmed === true &&
                  '✓ The signing key matches the issuer’s live published identity.'}
                {result.issuerKeyConfirmed === false &&
                  '⚠ The signing key does NOT match the issuer’s current published identity — treat with caution (keys may have rotated, or the issuer field is spoofed).'}
                {result.issuerKeyConfirmed === null &&
                  'Issuer identity could not be fetched — signature verified offline against the embedded key only.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
