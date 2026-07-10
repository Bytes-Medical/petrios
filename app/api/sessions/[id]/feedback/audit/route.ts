import { NextResponse } from 'next/server'
import { getSessionFeedbackAudit } from '@/app/actions/feedback'

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const audit = await getSessionFeedbackAudit(params.id)
    return NextResponse.json(audit)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch audit data' },
      { status: 500 }
    )
  }
}
