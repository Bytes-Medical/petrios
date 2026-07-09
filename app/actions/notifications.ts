'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/auth'
import * as notificationsDb from '@/lib/db/notifications'

export async function markNotificationRead(id: string) {
  const userId = await requireAuth()
  await notificationsDb.markNotificationRead(id, userId)
  revalidatePath('/dashboard')
  return { success: true }
}

export async function markAllNotificationsRead() {
  const userId = await requireAuth()
  await notificationsDb.markAllNotificationsRead(userId)
  revalidatePath('/dashboard')
  return { success: true }
}
