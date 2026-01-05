'use server'

import { createSupabaseClient } from '@/lib/supabase/server'
import { requireAuth, requireOrg, getCurrentUserId, requireDepartmentModerator } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import type { AttendanceStatus, AttendanceMethod } from '@/lib/types'

export async function checkIn(sessionId: string, groupCode?: string, codeVersion?: number) {
  const userId = await requireAuth()
  
  // Use evidence-based system
  const { addEvidence } = await import('./attendance-evidence')
  
  const source: 'SELF_CHECKIN' | 'GROUP_CODE' = groupCode ? 'GROUP_CODE' : 'SELF_CHECKIN'
  const metadata: any = {}
  
  if (groupCode && codeVersion !== undefined) {
    metadata.code_version = codeVersion
    // Note: In a full implementation, you'd validate the code matches the version
    // For MVP, we validate version and expiry in addEvidence
  }

  await addEvidence(sessionId, source, {
    userId,
    metadata,
  })

  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function markAttendance(
  sessionId: string,
  userId: string,
  status: AttendanceStatus
) {
  await requireAuth()
  
  // Use evidence-based system - create TEACHER evidence
  const { addEvidence, recomputeAttendance } = await import('./attendance-evidence')
  
  await addEvidence(sessionId, 'TEACHER', {
    userId,
    metadata: {
      status_override: status,
    },
  })

  // Recompute will happen automatically, but ensure it's done
  await recomputeAttendance(sessionId, userId, null)

  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function getAttendance(sessionId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch attendance: ${error.message}`)
  }

  return data || []
}

export async function exportAttendanceCSV(sessionId: string) {
  const orgId = await requireOrg()
  const supabase = await createSupabaseClient()

  const { data: attendance, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('org_id', orgId)
    .eq('session_id', sessionId)
    .order('first_evidence_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch attendance: ${error.message}`)
  }

  // Generate CSV with new fields
  const headers = ['User ID', 'External Email', 'Status', 'Primary Source', 'First Evidence At', 'Computed At', 'Locked']
  const rows = (attendance || []).map(a => [
    a.user_id || '',
    a.external_email || '',
    a.status,
    a.primary_source || '',
    a.first_evidence_at || '',
    a.computed_at || '',
    a.locked ? 'Yes' : 'No',
  ])

  const csv = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
  ].join('\n')

  return csv
}
