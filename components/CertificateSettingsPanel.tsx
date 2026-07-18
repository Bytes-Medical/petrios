'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from './Button'
import { Input } from './Input'
import { useToast } from './ToastProvider'
import { updateDepartmentCertificateSettings } from '@/app/actions/departments'
import {
  MAX_COORDINATOR_NAME_LENGTH,
  MAX_TEACHING_COORDINATORS,
} from '@/lib/certificates/coordinators'

interface CertificateSettingsPanelProps {
  departmentId: string
  initialCoordinatorNames: string[]
}

export function CertificateSettingsPanel({
  departmentId,
  initialCoordinatorNames,
}: CertificateSettingsPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [coordinatorNames, setCoordinatorNames] = useState<string[]>(
    initialCoordinatorNames.length > 0 ? initialCoordinatorNames : ['']
  )
  const [loading, setLoading] = useState(false)

  function updateName(index: number, value: string) {
    setCoordinatorNames((current) =>
      current.map((name, nameIndex) => (nameIndex === index ? value : name))
    )
  }

  function addCoordinator() {
    setCoordinatorNames((current) =>
      current.length < MAX_TEACHING_COORDINATORS ? [...current, ''] : current
    )
  }

  function removeCoordinator(index: number) {
    setCoordinatorNames((current) => {
      const next = current.filter((_, nameIndex) => nameIndex !== index)
      return next.length > 0 ? next : ['']
    })
  }

  async function handleSave() {
    setLoading(true)

    try {
      await updateDepartmentCertificateSettings(departmentId, coordinatorNames)
      showToast({
        variant: 'success',
        title: 'Certificate settings saved',
        description: 'New certificates will show the revised teaching coordinator names.',
      })
      router.refresh()
    } catch (err) {
      showToast({
        variant: 'error',
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Failed to save settings',
      })
    } finally {
      setLoading(false)
    }
  }

  function handlePreview() {
    window.open(`/api/certificates/preview?departmentId=${departmentId}`, '_blank')
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-mono text-sm font-bold">Certificate Settings</h3>
        <p className="mt-2 font-mono text-xs text-gray-500">
          Add up to four teaching coordinators in the order they should appear. Names are
          copied onto each new certificate, so changing this list does not rewrite certificates
          that have already been issued.
        </p>
      </div>

      <div className="space-y-3">
        {coordinatorNames.map((name, index) => (
          <div key={index} className="flex items-end gap-2">
            <Input
              label={`Teaching coordinator ${index + 1}`}
              type="text"
              value={name}
              onChange={(event) => updateName(index, event.target.value)}
              placeholder="e.g. Dr Jane Smith"
              maxLength={MAX_COORDINATOR_NAME_LENGTH}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => removeCoordinator(index)}
              className="mb-px px-3"
              aria-label={`Remove teaching coordinator ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      {coordinatorNames.length < MAX_TEACHING_COORDINATORS ? (
        <Button type="button" variant="secondary" size="sm" onClick={addCoordinator}>
          Add another coordinator
        </Button>
      ) : null}

      <p className="border-l-2 border-clay-600 pl-3 font-mono text-xs text-gray-600">
        Every certificate uses the Petrios wordmark, warm paper, ink, and clay colours. The
        preview uses sample recipient and session details.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="flex-1"
        >
          {loading ? 'Saving...' : 'Save Settings'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={handlePreview}
          className="flex-1"
        >
          Preview Certificate
        </Button>
      </div>
    </div>
  )
}
