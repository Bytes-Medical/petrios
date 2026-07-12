import { Nav } from '@/components/Nav'
import {
  getCurrentOrgId,
  getCurrentUserId,
  isOrgManager,
  isPersonalWorkspace,
  isSuperAdmin,
} from '@/lib/auth'
import * as organizationsDb from '@/lib/db/organizations'
import * as notificationsDb from '@/lib/db/notifications'
import * as opsDb from '@/lib/db/ops'
import type { AppNotification, OpsPendingAction } from '@/lib/types'

export async function NavShell() {
  const userId = await getCurrentUserId()
  const superAdmin = userId ? await isSuperAdmin() : false
  let adminLink: { href: string; label: string } | null = null
  let roleLabel: string | null = null
  let isPersonal = false
  let notifications: AppNotification[] = []
  let unreadCount = 0
  let pendingApprovals: OpsPendingAction[] | null = null
  let pendingApprovalsCount = 0

  if (userId) {
    try {
      notifications = await notificationsDb.listMyNotifications(userId)
      // The count is derivable from the list unless it was truncated at the
      // fetch limit — avoids a second query on every page render.
      unreadCount =
        notifications.length < 15
          ? notifications.filter((n) => !n.read_at).length
          : await notificationsDb.countUnreadNotifications(userId)
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

    // Petrios Ops surfaces (Ops link + approvals bell) are organiser-only.
    if (!superAdmin && !isPersonal) {
      try {
        const orgId = await getCurrentOrgId()
        if (orgId && (await isOrgManager(orgId))) {
          pendingApprovals = await opsDb.listPendingActions(orgId, {
            statuses: ['pending'],
            limit: 5,
          })
          pendingApprovalsCount =
            pendingApprovals.length < 5
              ? pendingApprovals.length
              : await opsDb.countPendingActions(orgId)
        }
      } catch (error) {
        // Non-fatal — e.g. migration 036 not applied yet. Nav renders without
        // the approvals bell.
        console.error('Failed to load ops approvals:', error)
      }
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
      pendingApprovals={pendingApprovals}
      pendingApprovalsCount={pendingApprovalsCount}
    />
  )
}
