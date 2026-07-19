'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth, requireDepartmentModerator, requireOrg } from '@/lib/auth'
import type { AttendanceStatus } from '@/lib/types'
import * as attendanceDb from '@/lib/db/attendance'
import * as sessionsDb from '@/lib/db/sessions'
import { DbNotFoundError } from '@/lib/db'

export async function checkIn(sessionId: string, groupCode?: string, codeVersion?: number) {
  const userId = await requireAuth()

  // Route through evidence-based system (business logic in attendance-evidence)
  const { addEvidence } = await import('./attendance-evidence')

  const source: 'SELF_CHECKIN' | 'GROUP_CODE' = groupCode ? 'GROUP_CODE' : 'SELF_CHECKIN'
  const metadata: Record<string, unknown> = {}

  if (groupCode && codeVersion !== undefined) {
    metadata.code_version = codeVersion
  }

  await addEvidence(sessionId, source, {
    userId,
    metadata,
    submittedCode: groupCode,
  })

  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function markAttendance(
  sessionId: string,
  userId: string,
  status: AttendanceStatus,
  reason: string
) {
  await requireAuth()

  const { addEvidence } = await import('./attendance-evidence')

  await addEvidence(sessionId, 'MODERATOR_CONFIRMATION', {
    userId,
    metadata: {
      status_override: status,
    },
    correctionReason: reason,
  })

  revalidatePath(`/sessions/${sessionId}`)
  return { success: true }
}

export async function markExternalAttendance(
  sessionId: string,
  externalEmail: string,
  status: AttendanceStatus,
  reason: string
) {
  await requireAuth()

  const normalizedEmail = externalEmail.trim().toLowerCase()
  if (!normalizedEmail) throw new Error('External teacher email is required')
  const { addEvidence } = await import('./attendance-evidence')

  await addEvidence(sessionId, 'MODERATOR_CONFIRMATION', {
    externalEmail: normalizedEmail,
    metadata: { status_override: status },
    correctionReason: reason,
  })

  revalidatePath(`/sessions/${sessionId}`)
  revalidatePath(`/sessions/${sessionId}/manage`)
  return { success: true }
}

export async function getAttendance(sessionId: string) {
  const orgId = await requireOrg()
  return attendanceDb.listAttendance(orgId, sessionId)
}

export async function exportAttendanceCSV(sessionId: string) {
  const orgId = await requireOrg()
  const session = await sessionsDb.findSessionScope(sessionId, orgId)
  if (!session) throw new DbNotFoundError('Session not found')
  await requireDepartmentModerator(session.department_id)
  const attendance = await attendanceDb.listAttendance(orgId, sessionId, {
    orderBy: 'first_evidence_at',
  })

  const headers = [
    'User ID',
    'External Email',
    'Status',
    'Primary Source',
    'First Evidence At',
    'Computed At',
    'Locked',
  ]
  const rows = attendance.map((a) => [
    a.user_id || '',
    a.external_email || '',
    a.status,
    a.primary_source || '',
    a.first_evidence_at || '',
    a.computed_at || '',
    a.locked ? 'Yes' : 'No',
  ])

  const safeCell = (value: string) => /^[=+\-@]/.test(value) ? `'${value}` : value
  const csv = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${safeCell(cell).replaceAll('"', '""')}"`).join(',')),
  ].join('\n')

  return csv
}
