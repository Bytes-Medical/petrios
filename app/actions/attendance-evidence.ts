'use server'

import { createSupabaseClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, getCurrentUserId, requireDepartmentModerator } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import crypto from 'crypto'

export type EvidenceSource = 'SELF_CHECKIN' | 'GROUP_CODE' | 'FEEDBACK' | 'TEACHER' | 'TEAMS'

export interface EvidenceMetadata {
  code_version?: number
  feedback_id?: string
  actor_user_id?: string
  status_override?: 'PRESENT' | 'LATE' | 'ABSENT'
  ip_hash?: string
  user_agent?: string
  [key: string]: any
}

/**
 * Add evidence to the attendance system
 */
export async function addEvidence(
  sessionId: string,
  source: EvidenceSource,
  payload: {
    userId?: string | null
    externalEmail?: string | null
    metadata?: EvidenceMetadata
  }
) {
  const supabase = await createSupabaseClient()
  const userId = await getCurrentUserId()
  const orgId = await requireOrg()

  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .select('*, departments:department_id (id, org_id)')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found')
  }

  // Validate permissions based on source
  switch (source) {
    case 'SELF_CHECKIN':
      if (!userId || payload.userId !== userId) {
        throw new Error('Unauthorized: can only check in yourself')
      }
      break
    case 'GROUP_CODE':
      if (!userId) {
        throw new Error('Authentication required for group code check-in')
      }
      // Validate group code version and expiry
      if (!session.group_code_enabled) {
        throw new Error('Group code is not enabled for this session')
      }
      if (session.group_code_version === null || session.group_code_version === 0) {
        throw new Error('No active group code for this session')
      }
      // Validate code version matches (if provided in metadata)
      if (payload.metadata?.code_version !== undefined) {
        if (session.group_code_version !== payload.metadata.code_version) {
          throw new Error('Invalid or expired group code version')
        }
      }
      if (session.group_code_expires_at && new Date() > new Date(session.group_code_expires_at)) {
        throw new Error('Group code has expired')
      }
      // Store code version in metadata
      if (!payload.metadata) {
        payload.metadata = {}
      }
      payload.metadata.code_version = session.group_code_version
      break
    case 'FEEDBACK':
      // Feedback can be anonymous, but if user_id provided, validate
      if (payload.userId && payload.userId !== userId) {
        throw new Error('Unauthorized')
      }
      break
    case 'TEACHER':
      await requireDepartmentModerator(session.department_id)
      break
    case 'TEAMS':
      await requireDepartmentModerator(session.department_id)
      break
  }

  // Validate time windows
  const now = new Date()
  const checkInStart = new Date(
    new Date(session.date_start).getTime() - (session.checkin_open_mins_before || 15) * 60 * 1000
  )
  const checkInEnd = new Date(
    new Date(session.date_start).getTime() + (session.checkin_close_mins_after || 45) * 60 * 1000
  )
  const feedbackEnd = new Date(
    new Date(session.date_end).getTime() + (session.feedback_valid_mins_after_end || 120) * 60 * 1000
  )

  let isValidTime = false
  switch (source) {
    case 'SELF_CHECKIN':
    case 'GROUP_CODE':
      isValidTime = now >= checkInStart && now <= checkInEnd
      break
    case 'FEEDBACK':
      isValidTime = now >= checkInStart && now <= feedbackEnd
      break
    case 'TEACHER':
    case 'TEAMS':
      isValidTime = true // Teacher/Teams evidence is always valid
      break
  }

  if (!isValidTime) {
    throw new Error(`Time window closed for ${source} evidence`)
  }

  // Add IP hash if available (from headers, would need to pass from route)
  const metadata: EvidenceMetadata = {
    ...payload.metadata,
    actor_user_id: userId || undefined,
  }

  // Insert evidence
  const { data: evidence, error: evidenceError } = await supabase
    .from('attendance_evidence')
    .insert({
      org_id: orgId,
      session_id: sessionId,
      department_id: session.department_id,
      user_id: payload.userId || null,
      external_email: payload.externalEmail || null,
      source,
      observed_at: now.toISOString(),
      metadata,
      created_by: userId || null,
    })
    .select()
    .single()

  if (evidenceError) {
    throw new Error(`Failed to add evidence: ${evidenceError.message}`)
  }

  // Recompute attendance if not locked
  if (!session.attendance_locked) {
    const targetUserId = payload.userId || null
    const targetEmail = payload.externalEmail || null
    await recomputeAttendance(sessionId, targetUserId, targetEmail)
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return evidence
}

/**
 * Recompute attendance for a user based on evidence
 */
export async function recomputeAttendance(
  sessionId: string,
  userId: string | null,
  externalEmail: string | null
) {
  if (!userId && !externalEmail) {
    throw new Error('Either userId or externalEmail required')
  }

  const supabase = await createSupabaseServiceClient()
  const orgId = await requireOrg()

  // Get session
  const { data: session } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Get all evidence for this user/session
  let evidenceQuery = supabase
    .from('attendance_evidence')
    .select('*')
    .eq('session_id', sessionId)
    .eq('org_id', orgId)
    .order('observed_at', { ascending: true })

  if (userId) {
    evidenceQuery = evidenceQuery.eq('user_id', userId)
  } else {
    evidenceQuery = evidenceQuery.eq('external_email', externalEmail)
  }

  const { data: allEvidence, error: evidenceError } = await evidenceQuery

  if (evidenceError) {
    throw new Error(`Failed to fetch evidence: ${evidenceError.message}`)
  }

  // Filter to valid evidence based on time windows
  const validEvidence = (allEvidence || []).filter(ev => {
    const observedAt = new Date(ev.observed_at)
    const checkInStart = new Date(
      new Date(session.date_start).getTime() - (session.checkin_open_mins_before || 15) * 60 * 1000
    )
    const checkInEnd = new Date(
      new Date(session.date_start).getTime() + (session.checkin_close_mins_after || 45) * 60 * 1000
    )
    const feedbackEnd = new Date(
      new Date(session.date_end).getTime() + (session.feedback_valid_mins_after_end || 120) * 60 * 1000
    )

    switch (ev.source) {
      case 'SELF_CHECKIN':
      case 'GROUP_CODE':
        return observedAt >= checkInStart && observedAt <= checkInEnd
      case 'FEEDBACK':
        return observedAt >= checkInStart && observedAt <= feedbackEnd
      case 'TEACHER':
      case 'TEAMS':
        return true
      default:
        return false
    }
  })

  if (validEvidence.length === 0) {
    // No valid evidence = ABSENT
    const { data: attendance } = await supabase
      .from('attendance')
      .upsert({
        org_id: orgId,
        session_id: sessionId,
        department_id: session.department_id,
        user_id: userId,
        external_email: externalEmail,
        status: 'ABSENT',
        primary_source: null,
        first_evidence_at: null,
        computed_at: new Date().toISOString(),
      }, {
        onConflict: userId ? 'session_id,user_id' : 'session_id,external_email',
      })
      .select()
      .single()

    return attendance
  }

  // Determine status based on evidence priority and timing
  // Priority: TEACHER > TEAMS > FEEDBACK > GROUP_CODE > SELF_CHECKIN
  const priority: Record<EvidenceSource, number> = {
    TEACHER: 5,
    TEAMS: 4,
    FEEDBACK: 3,
    GROUP_CODE: 2,
    SELF_CHECKIN: 1,
  }

  const sortedEvidence = validEvidence.sort((a, b) => {
    const priorityDiff = priority[b.source as EvidenceSource] - priority[a.source as EvidenceSource]
    if (priorityDiff !== 0) return priorityDiff
    return new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime()
  })

  const primaryEvidence = sortedEvidence[0]
  const firstEvidenceAt = new Date(primaryEvidence.observed_at)
  const sessionStart = new Date(session.date_start)
  const lateAfterMins = session.late_after_mins || 10

  // Check if late
  const isLate = firstEvidenceAt > new Date(sessionStart.getTime() + lateAfterMins * 60 * 1000)
  const status = isLate ? 'LATE' : 'PRESENT'

  // Check for status override in metadata
  const statusOverride = primaryEvidence.metadata?.status_override
  const finalStatus = statusOverride || status

  // Upsert computed attendance
  const { data: attendance, error: attendanceError } = await supabase
    .from('attendance')
    .upsert({
      org_id: orgId,
      session_id: sessionId,
      department_id: session.department_id,
      user_id: userId,
      external_email: externalEmail,
      status: finalStatus,
      primary_source: primaryEvidence.source,
      first_evidence_at: firstEvidenceAt.toISOString(),
      computed_at: new Date().toISOString(),
    }, {
      onConflict: userId ? 'session_id,user_id' : 'session_id,external_email',
    })
    .select()
    .single()

  if (attendanceError) {
    throw new Error(`Failed to compute attendance: ${attendanceError.message}`)
  }

  return attendance
}

/**
 * Lock attendance for a session
 */
export async function lockAttendance(sessionId: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseServiceClient()

  // Get session
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Check permissions
  await requireDepartmentModerator(session.department_id)

  // Lock session
  const { error: sessionError } = await supabase
    .from('sessions')
    .update({
      attendance_locked: true,
      attendance_locked_at: new Date().toISOString(),
      attendance_locked_by: userId,
    })
    .eq('id', sessionId)

  if (sessionError) {
    throw new Error(`Failed to lock session: ${sessionError.message}`)
  }

  // Lock all attendance records
  const { error: attendanceError } = await supabase
    .from('attendance')
    .update({
      locked: true,
      locked_at: new Date().toISOString(),
      locked_by: userId,
    })
    .eq('session_id', sessionId)
    .eq('org_id', orgId)

  if (attendanceError) {
    throw new Error(`Failed to lock attendance: ${attendanceError.message}`)
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

/**
 * Unlock attendance for a session
 */
export async function unlockAttendance(sessionId: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseServiceClient()

  // Get session
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Check permissions
  await requireDepartmentModerator(session.department_id)

  // Unlock session
  const { error: sessionError } = await supabase
    .from('sessions')
    .update({
      attendance_locked: false,
      attendance_locked_at: null,
      attendance_locked_by: null,
    })
    .eq('id', sessionId)

  if (sessionError) {
    throw new Error(`Failed to unlock session: ${sessionError.message}`)
  }

  // Unlock all attendance records
  const { error: attendanceError } = await supabase
    .from('attendance')
    .update({
      locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq('session_id', sessionId)
    .eq('org_id', orgId)

  if (attendanceError) {
    throw new Error(`Failed to unlock attendance: ${attendanceError.message}`)
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

/**
 * Generate or regenerate group code for a session
 */
export async function generateGroupCode(sessionId: string) {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  // Get session
  const { data: session } = await supabase
    .from('sessions')
    .select('department_id, date_end, checkin_close_mins_after, group_code_version')
    .eq('id', sessionId)
    .eq('org_id', orgId)
    .single()

  if (!session) {
    throw new Error('Session not found')
  }

  // Check permissions
  await requireDepartmentModerator(session.department_id)

  const expiresAt = new Date(
    new Date(session.date_end).getTime() + (session.checkin_close_mins_after || 45) * 60 * 1000
  )

  const newVersion = (session.group_code_version || 0) + 1

  // Increment version and set expiry
  const { data: updatedSession, error: updateError } = await supabase
    .from('sessions')
    .update({
      group_code_version: newVersion,
      group_code_expires_at: expiresAt.toISOString(),
    })
    .eq('id', sessionId)
    .select()
    .single()

  if (updateError) {
    throw new Error(`Failed to generate group code: ${updateError.message}`)
  }

  // Generate deterministic code using database function
  const { data: codeResult, error: codeError } = await supabase
    .rpc('generate_group_code', {
      p_session_id: sessionId,
      p_version: newVersion,
    })

  let code = 'XXXXXX'
  if (!codeError && codeResult) {
    code = codeResult
  } else {
    // Fallback to client-side generation if RPC fails
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
  }

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  
  return {
    code,
    version: newVersion,
    expiresAt: updatedSession.group_code_expires_at,
  }
}

/**
 * Get all evidence for a session
 */
export async function getSessionEvidence(sessionId: string) {
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

  // Only moderators can view evidence
  await requireDepartmentModerator(session.department_id)

  const { data, error } = await supabase
    .from('attendance_evidence')
    .select('*')
    .eq('session_id', sessionId)
    .eq('org_id', orgId)
    .order('observed_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch evidence: ${error.message}`)
  }

  return data || []
}
