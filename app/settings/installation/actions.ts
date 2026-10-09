'use server'
import { requireSuperAdmin, getCurrentUser } from '@/lib/auth'
import { getEmailClient, getFromAddress } from '@/lib/email'

export async function sendInstallationTestEmail() {
  await requireSuperAdmin()
  const user = await getCurrentUser()
  if (!user?.email) return { error: 'Administrator email is missing.' }
  try {
    const result = await getEmailClient().emails.send({ from: getFromAddress(), to: user.email, subject: 'Petrios email configuration test', text: 'Your Petrios installation can send email. You can now invite your teaching team.', html: '<p>Your Petrios installation can send email. You can now invite your teaching team.</p>' })
    return result.error ? { error: 'Email delivery failed. Check the provider settings and server logs.' } : { ok: true }
  } catch { return { error: 'Configure MAIL_FROM and SMTP or Resend in your deployment variables first.' } }
}
