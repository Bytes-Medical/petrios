'use client'

import { useState } from 'react'
import Link from 'next/link'

export function SetupForm() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  if (done) return <div className="space-y-5"><h2 className="text-xl font-semibold">Your installation is ready</h2><p>Sign in with your administrator email and password. You can configure email before inviting your team.</p><Link href="/login?mode=password" className="btn-primary inline-block">Sign in to Petrios</Link><p className="text-sm text-gray-600">After signing in, visit Settings → Installation to check services and email.</p></div>
  return <form className="space-y-5" onSubmit={async event => {
    event.preventDefault(); setPending(true); setError('')
    try {
      const response = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Setup failed')
      setDone(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'Please retry.') }
    finally { setPending(false) }
  }}>
    <p className="text-sm text-gray-600">Find your private SETUP_TOKEN in Railway’s Petrios service variables, or in the .env file created by the Compose installer.</p>
    {[
      ['code','Private setup code','password',32,256], ['name','Your name','text',1,120], ['email','Administrator email','email',1,254],
      ['password','Administrator password (at least 12 characters)','password',12,128], ['organisation','Organisation name','text',1,120], ['department','First department name','text',1,120],
    ].map(([name,label,type,min,max]) => <label key={name} className="block text-sm font-medium">{label}<input required name={String(name)} type={String(type)} minLength={Number(min)} maxLength={Number(max)} autoComplete={name === 'password' ? 'new-password' : name === 'code' ? 'off' : String(name)} className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-3" /></label>)}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button disabled={pending} className="btn-primary w-full">{pending ? 'Setting up…' : 'Create your installation'}</button>
  </form>
}
