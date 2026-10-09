import Link from 'next/link'
import { requireSuperAdmin } from '@/lib/auth'
import { installationReadiness } from '@/lib/self-hosting/readiness'
import { listInstallationJobs } from '@/lib/db/installation'
import { TestEmail } from './TestEmail'
import { getMeetingConfig } from '@/lib/meeting/config'
import { meetingStatusSummary } from '@/lib/meeting/status'
import { inviteCodeIsTrustedCapability } from '@/lib/teacher-invitation-capability'
export default async function InstallationPage() {
  await requireSuperAdmin()
  const [services, jobs] = await Promise.all([installationReadiness(), listInstallationJobs().catch(() => [])])
  const video = meetingStatusSummary(getMeetingConfig(), { externalTeacherPasses: inviteCodeIsTrustedCapability() })
  const mail = !!(process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL) && !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY)
  return <main className="mx-auto w-full max-w-3xl space-y-8 px-6 py-12"><Link href="/settings" className="text-sm underline">Back to settings</Link><h1 className="text-3xl font-semibold">Installation</h1><section className="space-y-3"><h2 className="text-xl font-semibold">Services</h2>{Object.entries(services).map(([name, ok]) => <p key={name} className="flex justify-between border-b py-2"><span className="capitalize">{name}</span><span>{ok ? 'Ready' : 'Needs attention'}</span></p>)}</section><section className="space-y-4"><h2 className="text-xl font-semibold">Email: {mail ? 'configured' : 'not configured'}</h2><p>Set MAIL_FROM and either RESEND_API_KEY or SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in Railway’s Petrios service variables or your Compose .env file. Restart Petrios after changing them. Set SMTP_SECURE=true only for implicit TLS, usually port 465.</p><p>For Supabase’s own confirmation and recovery emails, also configure the Auth service SMTP variables. Administrator password login works without email.</p><a className="underline" href="https://github.com/Bytes-Medical/petrios/blob/main/docs/self-hosting.md">Read the deployment guide</a><TestEmail /></section><section className="space-y-3"><h2 className="text-xl font-semibold">Video (Petrios Meet): {video.ready ? 'ready' : 'needs attention'}</h2><p className="flex justify-between border-b py-2"><span>Mode</span><span>{video.mode}</span></p><p className="text-sm">{video.detail}</p></section><section className="space-y-3"><h2 className="text-xl font-semibold">Scheduled jobs</h2><p className="text-sm">Jobs begin after setup and email configuration. AI jobs additionally require Ops and an AI provider. A recorded success means the endpoint completed; check individual delivery records for recipient outcomes.</p>{jobs.map(job => <div key={job.name} className="border-b py-3"><p>{job.name}</p><p className="text-sm text-gray-600">{job.last_success ? `Last completed: ${new Date(job.last_success).toISOString()}` : 'Not run yet'}{job.last_error ? ` · ${job.last_error}` : ''}</p></div>)}</section></main>
}
