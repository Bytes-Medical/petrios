
import { getPublicRuntimeConfig } from '@/lib/runtime-config'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    const response = NextResponse.json({ success: true })

    const supabase = createServerClient(
      process.env.SUPABASE_INTERNAL_URL || getPublicRuntimeConfig().supabaseUrl,
      getPublicRuntimeConfig().supabaseAnonKey,
      {
        cookieOptions: { name: `sb-${new URL(getPublicRuntimeConfig().supabaseUrl).hostname.split('.')[0]}-auth-token` },
      cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value
          },
          set(name: string, value: string, options?: any) {
            response.cookies.set(name, value, {
              ...options,
              sameSite: 'lax' as const,
            })
          },
          remove(name: string, options?: any) {
            response.cookies.set(name, '', {
              ...options,
              sameSite: 'lax' as const,
              maxAge: 0,
            })
          },
        },
      }
    )

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      )
    }

    if (!data.session) {
      return NextResponse.json(
        { error: 'No session created. Please check if email confirmation is required.' },
        { status: 400 }
      )
    }

    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
