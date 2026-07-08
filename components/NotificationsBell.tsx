'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions/notifications'
import type { AppNotification } from '@/lib/types'
import { cn } from '@/lib/utils'

interface NotificationsBellProps {
  notifications: AppNotification[]
  unreadCount: number
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function NotificationsBell({ notifications, unreadCount }: NotificationsBellProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  async function openNotification(n: AppNotification) {
    setOpen(false)
    if (!n.read_at) {
      try {
        await markNotificationRead(n.id)
      } catch {
        // Non-fatal — navigation still proceeds.
      }
    }
    if (n.link) {
      router.push(n.link)
    }
    router.refresh()
  }

  async function markAll() {
    try {
      await markAllNotificationsRead()
      router.refresh()
    } catch {
      // Non-fatal.
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={
          unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'
        }
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center border border-black bg-white hover:bg-gray-50"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center bg-clay-600 px-1 font-mono text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 border border-black bg-white shadow-[4px_4px_0_0_#1F1D1A]">
          <div className="flex items-center justify-between border-b border-black px-3 py-2">
            <span className="font-mono text-xs font-bold uppercase tracking-wider">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAll}
                className="font-mono text-xs underline underline-offset-2 hover:text-clay-700"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center font-mono text-xs text-gray-500">
                Nothing yet — you&apos;ll see teaching responses and updates here.
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className={cn(
                    'block w-full border-b border-gray-200 px-3 py-2.5 text-left last:border-b-0 hover:bg-gray-50',
                    !n.read_at && 'bg-clay-50'
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold">{n.title}</span>
                    {!n.read_at && (
                      <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 bg-clay-600" />
                    )}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block font-mono text-xs text-gray-600">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-1 block font-mono text-[10px] uppercase tracking-wider text-gray-400">
                    {relativeTime(n.created_at)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
