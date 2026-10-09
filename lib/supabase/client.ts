'use client'

import { getPublicRuntimeConfig } from '@/lib/runtime-config'

import { createBrowserClient } from '@supabase/ssr'

let supabaseClient: ReturnType<typeof createBrowserClient> | null = null

export function createSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient
  }

  supabaseClient = createBrowserClient(
    getPublicRuntimeConfig().supabaseUrl,
    getPublicRuntimeConfig().supabaseAnonKey
  )

  return supabaseClient
}
