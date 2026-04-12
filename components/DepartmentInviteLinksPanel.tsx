'use client'

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/Button'
import { useToast } from '@/components/ToastProvider'
import { rotateDepartmentInviteLink } from '@/app/actions/member-onboarding'
import type { ManagedDepartmentInviteLink } from '@/lib/types'

interface DepartmentInviteLinksPanelProps {
  links: ManagedDepartmentInviteLink[]
}

export function DepartmentInviteLinksPanel({ links }: DepartmentInviteLinksPanelProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({})
  const [loadingDepartmentId, setLoadingDepartmentId] = useState<string | null>(null)
  const linkKeys = useMemo(() => links.map((link) => `${link.department_id}:${link.invite_url}`).join('|'), [links])

  useEffect(() => {
    let active = true

    async function generateQRCodes() {
      const nextQRCodes = await Promise.all(
        links.map(async (link) => {
          try {
            const url = await QRCode.toDataURL(link.invite_url, {
              width: 180,
              margin: 1,
            })
            return [link.department_id, url] as const
          } catch (error) {
            console.error('Failed to generate invite QR code', error)
            return [link.department_id, ''] as const
          }
        })
      )

      if (!active) {
        return
      }

      setQrCodes(
        nextQRCodes.reduce<Record<string, string>>((accumulator, [departmentId, url]) => {
          accumulator[departmentId] = url
          return accumulator
        }, {})
      )
    }

    generateQRCodes()

    return () => {
      active = false
    }
  }, [linkKeys, links])

  async function handleCopy(inviteUrl: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      showToast({
        variant: 'success',
        title: 'Invite link copied',
        description: 'The department invite link is ready to share.',
      })
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Copy failed',
        description: error instanceof Error ? error.message : 'Could not copy invite link.',
      })
    }
  }

  async function handleRotate(departmentId: string) {
    setLoadingDepartmentId(departmentId)

    try {
      await rotateDepartmentInviteLink(departmentId)
      showToast({
        variant: 'success',
        title: 'Invite link rotated',
        description: 'The previous invite code has been replaced.',
      })
      router.refresh()
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Rotation failed',
        description: error instanceof Error ? error.message : 'Failed to rotate invite link',
      })
    } finally {
      setLoadingDepartmentId(null)
    }
  }

  if (links.length === 0) {
    return (
      <p className="font-mono text-sm text-gray-600">
        No manageable departments found for invite links.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {links.map((link) => (
          <div key={link.department_id} className="border border-black bg-white p-4">
            <div className="mb-4">
              <h3 className="font-mono text-lg font-bold">{link.department_name}</h3>
              <p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-gray-500">
                Reusable department invite
              </p>
            </div>

            <div className="mb-4 space-y-2">
              <label className="block font-mono text-xs uppercase tracking-[0.2em] text-gray-500">
                Department Code
              </label>
              <div className="flex items-center gap-2">
                <span className="border border-black bg-gray-50 px-4 py-2 font-mono text-2xl font-bold tracking-[0.3em]">
                  {link.department_code}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => handleCopy(link.department_code)}
                >
                  Copy
                </Button>
              </div>
              <p className="font-mono text-xs text-gray-500">
                Trainees can join at /join/dept using this code
              </p>
            </div>

            <div className="mb-4 space-y-2">
              <label className="block font-mono text-xs uppercase tracking-[0.2em] text-gray-500">
                Invite Link
              </label>
              <input
                readOnly
                value={link.invite_url}
                className="w-full border border-black bg-white px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="button" variant="secondary" onClick={() => handleCopy(link.invite_url)}>
                Copy Link
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={loadingDepartmentId === link.department_id}
                onClick={() => handleRotate(link.department_id)}
              >
                {loadingDepartmentId === link.department_id ? 'Rotating...' : 'Rotate Code'}
              </Button>
            </div>

            <div className="mt-5 border-t border-black pt-4">
              <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-gray-500">
                QR Code
              </p>
              {qrCodes[link.department_id] ? (
                <img
                  src={qrCodes[link.department_id]}
                  alt={`${link.department_name} invite QR code`}
                  className="border border-black bg-white p-3"
                />
              ) : (
                <p className="font-mono text-sm text-gray-600">Generating QR code...</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
