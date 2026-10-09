import { NextRequest, NextResponse } from 'next/server'
import { unauthorizedCronResponse } from '@/lib/cron-auth'
import { mapSettledWithConcurrency } from '@/lib/concurrency'
import { awardRecallCompletion } from '@/lib/recall-awards'
import * as recallDb from '@/lib/db/recall'

// Each award holds a rendered certificate PDF plus its base64 attachment.
// Fifty in parallel peaked at ~141 MiB, over a 128 MB Workers isolate. Every
// attempt rewrites updated_at, so oldest-first selection rotates retried rows
// behind the rest of the queue.
const BATCH_SIZE = 10
const CONCURRENCY = 2

/** Retry certificate issuance/email after a successful catch-up completion. */
export async function GET(request: NextRequest) {
  const unauthorized = unauthorizedCronResponse(request)
  if (unauthorized) return unauthorized

  const pending = await recallDb.listCompletionsNeedingAward(BATCH_SIZE + 1)
  const batch = pending.slice(0, BATCH_SIZE)
  const results = await mapSettledWithConcurrency(batch, CONCURRENCY, (completion) =>
    awardRecallCompletion(completion)
  )
  const delivered = results.filter(
    (result) => result.status === 'fulfilled' && result.value.award_status === 'DELIVERED'
  ).length
  const failed = results.filter((result) => result.status === 'rejected').length
  return NextResponse.json({
    processed: batch.length,
    delivered,
    failed,
    morePending: pending.length > batch.length,
  })
}
