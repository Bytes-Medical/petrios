'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Button } from './Button'
import { createOrganizationAsSuperAdmin } from '@/app/actions/super-admin'

export function SuperAdminOrganizationForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = e.currentTarget
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string

    try {
      await createOrganizationAsSuperAdmin(name)
      router.refresh()
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-4 border border-red-500 bg-red-50">
          <p className="font-mono text-sm text-red-800">{error}</p>
        </div>
      )}

      <Input
        label="Organization Name"
        name="name"
        required
      />

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Organization'}
      </Button>
    </form>
  )
}
