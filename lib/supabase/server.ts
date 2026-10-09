
import { getPublicRuntimeConfig } from '@/lib/runtime-config'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.SUPABASE_INTERNAL_URL || getPublicRuntimeConfig().supabaseUrl,
    getPublicRuntimeConfig().supabaseAnonKey,
    {
      cookieOptions: { name: `sb-${new URL(getPublicRuntimeConfig().supabaseUrl).hostname.split('.')[0]}-auth-token` },
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options?: any) {
          try {
            cookieStore.set(name, value, options)
          } catch {
            // Ignore when called in a Server Component without mutation support.
          }
        },
        remove(name: string, options?: any) {
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
    process.env.SUPABASE_INTERNAL_URL || getPublicRuntimeConfig().supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        fetch: (url: RequestInfo | URL, init?: RequestInit) =>
          fetch(url, { ...init, cache: 'no-store' }),
      },
    }
  )
}
