'use client'
import { useState } from 'react'
import { sendInstallationTestEmail } from './actions'
export function TestEmail() {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  return <div><button className="btn-primary" disabled={pending} onClick={async () => {
    setPending(true)
    try { const result = await sendInstallationTestEmail(); setMessage(result.error || 'Test submitted. Check your administrator inbox.') }
    catch { setMessage('Test failed. Please retry.') }
    finally { setPending(false) }
  }}>{pending ? 'Sending…' : 'Send test email to me'}</button><p role="status" className="mt-3 text-sm">{message}</p></div>
}
