import { NextRequest, NextResponse } from 'next/server'
import { exportAttendanceCSV } from '@/app/actions/attendance'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const csv = await exportAttendanceCSV(params.id)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="attendance-${params.id}.csv"`,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export attendance' },
      { status: 500 }
    )
  }
}
