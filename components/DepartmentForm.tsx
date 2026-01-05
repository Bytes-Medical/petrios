'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from './Input'
import { Button } from './Button'
import { createDepartment } from '@/app/actions/departments'

export function DepartmentForm() {
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
      await createDepartment(name)
      router.refresh()
      form.reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create department')
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
        label="Department Name"
        name="name"
        required
      />

      <Button type="submit" disabled={loading}>
        {loading ? 'Creating...' : 'Create Department'}
      </Button>
    </form>
  )
}
