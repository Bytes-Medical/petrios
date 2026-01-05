'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

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
