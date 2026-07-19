'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getAppUrlFromHeaders } from '@/lib/app-url'
import { safeNextPath } from '@/lib/safe-next-path'

/**
 * Microsoft Entra ID SSO (works with NHSmail accounts). Auth-plane: builds
 * the provider redirect URL via Supabase's `azure` OAuth provider — the
 * PKCE code verifier is stored in cookies by the server client, and
 * /join/callback completes the exchange when Microsoft redirects back.
 * Requires the Azure provider to be configured in Supabase Auth.
 */
export async function getMicrosoftSignInUrl(
  nextPath = '/dashboard'
): Promise<{ url?: string; error?: string }> {
  const supabase = await createSupabaseClient()
  const baseUrl = await getAppUrlFromHeaders()
  const safeNext = safeNextPath(nextPath)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: `${baseUrl}/join/callback?mode=login&next=${encodeURIComponent(safeNext)}`,
      scopes: 'email',
    },
  })

  if (error || !data?.url) {
    console.error(`[auth] Microsoft sign-in unavailable: ${error?.message ?? 'no URL returned'}`)
    return {
      error:
        'Microsoft sign-in is not available on this deployment. Use the email sign-in link instead.',
    }
  }

  return { url: data.url }
}

export async function signIn(email: string, password: string) {
  const supabase = await createSupabaseClient()
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }

  if (!data.session) {
    return { error: 'No session created. Please check if email confirmation is required.' }
  }

  // The session cookies are automatically set by the server client
  // We just need to ensure they're persisted
  const cookieStore = await cookies()
  
  // Redirect will happen after this function returns
  return { success: true, session: data.session }
}
