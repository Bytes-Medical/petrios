import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { isLlmConfigured } from '@/lib/ai/llm'
import { getInstallationState, listInstallationJobs, claimInstallationJob, finishInstallationJob } from '@/lib/db/installation'
import { GET as reminders } from '@/app/api/cron/session-reminders/route'
import { GET as reports } from '@/app/api/cron/post-session-reports/route'
import { GET as recallSend } from '@/app/api/cron/recall-send/route'
import { GET as recallAwards } from '@/app/api/cron/recall-awards/route'
import { GET as synthesis } from '@/app/api/cron/ops-synthesis/route'
import { GET as weekly } from '@/app/api/cron/ops-weekly/route'

export const dynamic = 'force-dynamic'
const handlers: Record<string, (request: NextRequest) => Promise<Response>> = {
  'session-reminders': reminders, 'post-session-reports': reports, 'recall-send': recallSend,
  'recall-awards': recallAwards, 'ops-synthesis': synthesis, 'ops-weekly': weekly,
}
export async function POST(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized
  const state = await getInstallationState()
  const mail = !!(process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL) && !!(process.env.SMTP_HOST || process.env.RESEND_API_KEY)
  if ((!state.completed_at && !state.blocked) || !mail) return NextResponse.json({ skipped: 'Setup or email configuration incomplete' })
  const results: Record<string, string> = {}
  for (const job of await listInstallationJobs()) {
    if (job.name.startsWith('ops-') && (process.env.OPS_ENABLED === 'false' || !isLlmConfigured())) continue
    if (!handlers[job.name]) continue
    const lease = await claimInstallationJob(job.name)
    if (!lease) continue
    let success = false
    try { success = (await handlers[job.name](request)).ok }
    catch { /* Do not log tenant data or secrets. */ }
    await finishInstallationJob(job.name, lease, success)
    results[job.name] = success ? 'completed' : 'failed'
  }
  return NextResponse.json({ jobs: results }, { status: Object.values(results).includes('failed') ? 503 : 200 })
}
