'use client'

import { useState } from 'react'

interface SuperAdminTabsProps {
  manage: React.ReactNode
  users: React.ReactNode
  notifications: React.ReactNode
}

export function SuperAdminTabs({ manage, users, notifications }: SuperAdminTabsProps) {
  const [active, setActive] = useState<'manage' | 'users' | 'notifications'>('manage')

  const tabClass = (tab: string) =>
    `px-4 py-2 border border-black font-mono text-sm ${
      active === tab ? 'bg-black text-white' : 'bg-white text-black'
    }`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={tabClass('manage')} onClick={() => setActive('manage')}>
          Manage
        </button>
        <button type="button" className={tabClass('users')} onClick={() => setActive('users')}>
          Users
        </button>
        <button
          type="button"
          className={tabClass('notifications')}
          onClick={() => setActive('notifications')}
        >
          Notifications
        </button>
      </div>

      {active === 'manage' && manage}
      {active === 'users' && users}
      {active === 'notifications' && notifications}
    </div>
  )
}
