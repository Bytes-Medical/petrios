import { NextRequest, NextResponse } from 'next/server'
import { generateGroupCode } from '@/app/actions/attendance-evidence'

export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const result = await generateGroupCode(params.id)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate group code' },
      { status: 500 }
    )
  }
}
