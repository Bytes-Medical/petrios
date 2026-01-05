'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Input } from '@/components/Input'
import { Button } from '@/components/Button'
import Link from 'next/link'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      })

      // If not ok, check for error
      if (!response.ok) {
        const data = await response.json()
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      // Wait a moment for cookies to be fully set, then redirect
      // This ensures cookies are available when middleware runs
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Force a full page navigation to ensure cookies are sent
      window.location.replace('/dashboard')
    } catch (err) {
      console.error('Unexpected error:', err)
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md border border-black p-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <Image
            src="/assets/byte_logo.png"
            alt="Byte Teaching Logo"
            width={200}
            height={133}
            className="w-auto h-auto max-w-full"
            priority
          />
        </div>
        <h2 className="text-lg sm:text-xl font-mono font-bold mb-4 sm:mb-6 text-center">Login</h2>
        
        {error && (
          <div className="p-4 border border-red-500 bg-red-50 mb-4">
            <p className="font-mono text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Logging in...' : 'Login'}
          </Button>
        </form>

        <p className="font-mono text-sm mt-4 text-center">
          Don't have an account?{' '}
          <Link href="/signup" className="underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
