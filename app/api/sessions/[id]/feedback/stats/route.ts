import { NextRequest, NextResponse } from 'next/server'
import { getSessionFeedbackStats } from '@/app/actions/feedback'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const stats = await getSessionFeedbackStats(params.id)
    return NextResponse.json(stats)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch feedback stats' },
      { status: 500 }
    )
  }
}
