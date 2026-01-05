'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, getCurrentUserId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function createOrganization(name: string) {
  const userId = await requireAuth()
  const supabase = await createSupabaseClient()

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name,
      created_by: userId,
    })
    .select()
    .single()

  if (orgError) {
    throw new Error(`Failed to create organization: ${orgError.message}`)
  }

  // Add creator as org_admin
  const { error: memberError } = await supabase
    .from('organization_members')
    .insert({
      org_id: org.id,
      user_id: userId,
      role: 'org_admin',
    })

  if (memberError) {
    throw new Error(`Failed to add member: ${memberError.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath('/admin')
  return org
}

export async function getMyOrganizations() {
  const userId = await getCurrentUserId()
  if (!userId) return []

  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('organization_members')
    .select(`
      *,
      organizations:org_id (*)
    `)
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Failed to fetch organizations: ${error.message}`)
  }

  return data || []
}

export async function getOrganization(id: string) {
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    throw new Error(`Failed to fetch organization: ${error.message}`)
  }

  return data
}
