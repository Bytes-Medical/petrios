import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value
        },
        set(name, value, options) {
          try {
            cookieStore.set(name, value, options)
          } catch {
            // Ignore when called in a Server Component without mutation support.
          }
        },
        remove(name, options) {
          try {
            cookieStore.set(name, '', { ...options, maxAge: 0 })
          } catch {
            // Ignore when called in a Server Component without mutation support.
          }
        },
      },
    }
  )
}

export async function createSupabaseServiceClient() {
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
