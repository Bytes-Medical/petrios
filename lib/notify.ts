import { getEmailClient, getFromAddress } from '@/lib/email'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import * as notificationsDb from '@/lib/db/notifications'

/**
 * Notify a registered user by in-app notification and email in one call.
 * Both channels are best-effort and non-fatal: the triggering action (a
 * teacher response, a slot claim) must succeed even when notifying fails.
 * Email resolution is auth-plane (GoTrue admin API), same as the rest of the
 * app.
 */
export async function notifyUser(input: {
  orgId: string
  userId: string
  notification: { type: string; title: string; body?: string; link?: string }
  email?: { subject: string; html: string }
}): Promise<void> {
  try {
    await notificationsDb.insertNotificationAsSystem({
      orgId: input.orgId,
      userId: input.userId,
      type: input.notification.type,
      title: input.notification.title,
      body: input.notification.body,
      link: input.notification.link,
    })
  } catch (err) {
    console.error(`Failed to create ${input.notification.type} notification:`, err)
  }

  if (!input.email) return

  try {
    const supabase = await createSupabaseServiceClient()
    const { data: userData } = await supabase.auth.admin.getUserById(input.userId)
    if (userData?.user?.email) {
      const mailer = getEmailClient()
      await mailer.emails.send({
        from: getFromAddress(),
        to: userData.user.email,
        subject: input.email.subject,
        html: input.email.html,
      })
    }
  } catch (err) {
    console.error(`Failed to email ${input.notification.type} notification:`, err)
  }
}
