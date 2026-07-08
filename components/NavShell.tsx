import { Nav } from '@/components/Nav'
import { getCurrentUserId, isSuperAdmin, isPersonalWorkspace } from '@/lib/auth'
import * as organizationsDb from '@/lib/db/organizations'
import * as notificationsDb from '@/lib/db/notifications'
import type { AppNotification } from '@/lib/types'

export async function NavShell() {
  const userId = await getCurrentUserId()
  const superAdmin = userId ? await isSuperAdmin() : false
  let adminLink: { href: string; label: string } | null = null
  let roleLabel: string | null = null
  let isPersonal = false
  let notifications: AppNotification[] = []
  let unreadCount = 0

  if (userId) {
    try {
      ;[notifications, unreadCount] = await Promise.all([
        notificationsDb.listMyNotifications(userId),
        notificationsDb.countUnreadNotifications(userId),
      ])
    } catch (error) {
      // Non-fatal — the nav renders without the bell contents.
      console.error('Failed to load notifications:', error)
    }
  }

  if (userId) {
    if (superAdmin) {
      adminLink = { href: '/super-admin', label: 'Super Admin' }
      roleLabel = 'Super Admin'
    } else if (await isPersonalWorkspace()) {
      // Individual account: no enterprise admin surface.
      isPersonal = true
      roleLabel = 'Individual'
    } else if (await organizationsDb.userIsOrgAdminAnywhere(userId)) {
      adminLink = { href: '/admin', label: 'Admin' }
      roleLabel = 'Org Admin'
    } else if (await organizationsDb.userIsDepartmentAdminAnywhere(userId)) {
      roleLabel = 'Moderator'
    }
  }

  return (
    <Nav
      adminLink={adminLink}
      roleLabel={roleLabel}
      isSuperAdmin={superAdmin}
      isPersonal={isPersonal}
      notifications={notifications}
      unreadCount={unreadCount}
    />
  )
}
