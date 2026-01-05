'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { Session, LocationType, SessionStatus } from '@/lib/types'

export async function createSession(sessionData: {
  department_id: string
  title: string
  description?: string
  date_start: string
  date_end: string
  location_type: LocationType
}) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireDepartmentModerator(sessionData.department_id)
  const supabase = await createSupabaseClient()

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      org_id: orgId,
      department_id: sessionData.department_id,
      title: sessionData.title,
      description: sessionData.description || null,
      date_start: sessionData.date_start,
      date_end: sessionData.date_end,
      location_type: sessionData.location_type,
      teams_meeting_url: null,
      status: 'DRAFT',
      tags: null,
      capacity: null,
      created_by: userId,
    })
    .select()
    .single()

  if (sessionError) {
    throw new Error(`Failed to create session: ${sessionError.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${sessionData.department_id}/sessions`)
  return session
}

export async function getSessions(departmentId?: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  let query = supabase
    .from('sessions')
    .select('*')
    .eq('org_id', orgId)
    .order('date_start', { ascending: true })

  if (departmentId) {
    query = query.eq('department_id', departmentId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to fetch sessions: ${error.message}`)
  }

  return data || []
}

export async function getSession(id: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  if (error) {
    throw new Error(`Failed to fetch session: ${error.message}`)
  }

  return data
}

export async function updateSession(id: string, updates: Partial<Session>) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session to check permissions
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', id)
    .eq('org_id', orgId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to update session: ${error.message}`)
  }

  revalidatePath(`/sessions/${id}`)
  revalidatePath(`/sessions/${id}/manage`)
  revalidatePath('/dashboard')
  return data
}

export async function updateSessionMeetingUrl(sessionId: string, meetingUrl: string) {
  return updateSession(sessionId, { teams_meeting_url: meetingUrl })
}

export async function updateSessionStatus(sessionId: string, status: SessionStatus) {
  return updateSession(sessionId, { status })
}

export async function addSessionTeacher(sessionId: string, userId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session to check permissions
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  // Verify user is a member of the department
  const { data: member } = await supabase
    .from('department_members')
    .select('id')
    .eq('department_id', session.department_id)
    .eq('user_id', userId)
    .single()

  if (!member) {
    throw new Error('User is not a member of this department')
  }

  const { data, error } = await supabase
    .from('session_teachers')
    .insert({
      org_id: orgId,
      session_id: sessionId,
      user_id: userId,
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to add teacher: ${error.message}`)
  }

  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return data
}

export async function removeSessionTeacher(sessionId: string, userId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session to check permissions
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const { error } = await supabase
    .from('session_teachers')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .eq('org_id', orgId)

  if (error) {
    throw new Error(`Failed to remove teacher: ${error.message}`)
  }

  revalidatePath(`/sessions/${sessionId}/manage`)
  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function deleteSession(sessionId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('id, department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found')
  }

  await requireDepartmentModerator(session.department_id)

  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)
    .eq('org_id', orgId)

  if (error) {
    throw new Error(`Failed to delete session: ${error.message}`)
  }

  revalidatePath('/dashboard')
  revalidatePath(`/departments/${session.department_id}/sessions`)
  return { success: true }
}

export async function getSessionTeachers(sessionId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('session_teachers')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)

  if (error) {
    throw new Error(`Failed to fetch teachers: ${error.message}`)
  }

  return data || []
}
