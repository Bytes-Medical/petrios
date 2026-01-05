import { NextResponse } from 'next/server'
import { createSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createSupabaseClient()
    
    // Try to get session first
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    
    // Then try to get user
    const { data: { user }, error: userError } = await supabase.auth.getUser()
    
    return NextResponse.json({
      hasSession: !!session,
      hasUser: !!user,
      userId: user?.id,
      userEmail: user?.email,
      sessionError: sessionError?.message,
      userError: userError?.message,
      sessionExpiresAt: session?.expires_at,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      stack: err instanceof Error ? err.stack : undefined,
    }, { status: 500 })
  }
}
