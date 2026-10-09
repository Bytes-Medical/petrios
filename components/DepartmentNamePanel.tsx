'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { useToast } from './ToastProvider'
import { updateDepartmentName } from '@/app/actions/departments'
import { MAX_TENANT_NAME_LENGTH } from '@/lib/tenant-names'

interface DepartmentNamePanelProps {
  departmentId: string
  initialName: string
}

export function DepartmentNamePanel({ departmentId, initialName }: DepartmentNamePanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [name, setName] = useState(initialName)
  const [loading, setLoading] = useState(false)

  const trimmed = name.trim()
  const unchanged = trimmed === initialName

  async function handleSave() {
    setLoading(true)

    try {
      await updateDepartmentName(departmentId, name)
      showToast({
        variant: 'success',
        title: 'Department renamed',
        description: 'The new name now appears on sessions, certificates, and emails.',
      })
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Rename failed',
        description: err instanceof Error ? err.message : 'Failed to rename department',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono text-sm font-bold">Department Name</h3>
        <p className="mt-2 font-mono text-xs text-gray-500">
          Shown on session pages, certificates, and emails. Names must be unique within your
          organisation. The department code and invite links do not change.
        </p>
      </div>

      <Input
        label="Department name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={MAX_TENANT_NAME_LENGTH}
      />

      <Button
        type="button"
        onClick={handleSave}
        disabled={loading || unchanged || !trimmed}
        className="w-full sm:w-auto"
      >
        {loading ? 'Saving...' : 'Save Name'}
      </Button>
    </div>
  )
}
