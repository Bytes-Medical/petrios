import type { AppNotification } from '@/lib/types'
import { getDb, getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Service-role: notifications are written on behalf of OTHER users (e.g. a
 * teacher's response notifying the inviting moderator), which the recipient's
 * RLS could never allow. The table intentionally has no INSERT policy.
 */
export async function insertNotificationAsSystem(input: {
  orgId: string
  userId: string
  type: string
  title: string
  body?: string | null
  link?: string | null
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('notifications').insert({
    org_id: input.orgId,
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
  })

  if (error) throw toDbError('Failed to create notification', error)
}

/** Recent notifications for the signed-in user (RLS scopes to own rows). */
export async function listMyNotifications(
  userId: string,
  limit = 15
): Promise<AppNotification[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw toDbError('Failed to list notifications', error)
  return (data as AppNotification[] | null) ?? []
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const db = await getDb()
  const { count, error } = await db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)

  if (error) throw toDbError('Failed to count notifications', error)
  return count ?? 0
}

export async function markNotificationRead(
  id: string,
  userId: string
): Promise<void> {
  const db = await getDb()
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('read_at', null)

  if (error) throw toDbError('Failed to mark notification read', error)
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const db = await getDb()
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null)

  if (error) throw toDbError('Failed to mark notifications read', error)
}
