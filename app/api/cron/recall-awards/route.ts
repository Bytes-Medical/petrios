import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { awardRecallCompletion } from '@/lib/recall-awards'
import * as recallDb from '@/lib/db/recall'

/** Retry certificate issuance/email after a successful catch-up completion. */
export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const pending = await recallDb.listCompletionsNeedingAward()
  const results = await Promise.allSettled(pending.map(awardRecallCompletion))
  const delivered = results.filter(
    (result) => result.status === 'fulfilled' && result.value.award_status === 'DELIVERED'
  ).length
  const failed = results.filter((result) => result.status === 'rejected').length
  return NextResponse.json({ processed: pending.length, delivered, failed })
}
