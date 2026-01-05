import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase/server'
import { requireOrg } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const orgId = await requireOrg()
    const supabase = await createSupabaseClient()

    const { data: session, error } = await supabase
      .from('sessions')
      .select('id, group_code_version')
      .eq('id', params.id)
      .eq('org_id', orgId)
      .single()

    if (error || !session || !session.group_code_version || session.group_code_version === 0) {
      return NextResponse.json({ code: null })
    }

    // Generate deterministic code
    const { data: code, error: codeError } = await supabase
      .rpc('generate_group_code', {
        p_session_id: session.id,
        p_version: session.group_code_version,
      })

    if (codeError) {
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
    }

    return NextResponse.json({ code: code || 'XXXXXX' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get group code' },
      { status: 500 }
    )
  }
}
