'use server'

import { requireAuth, requireOrg, isOrgAdmin, isSuperAdmin } from '@/lib/auth'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { getMyModeratedDepartments, getDepartments } from './departments'
import * as auditDb from '@/lib/db/audit'
import * as onboardingDb from '@/lib/db/onboarding'

export interface AuditSummaryStats {
  totalSessions: number
  averageAttendanceRate: number
  averageFeedbackRating: number
  certificatesIssued: number
}

export interface AuditSessionRow {
  id: string
  title: string
  dateStart: string
  status: string
  departmentName: string
  attendancePresent: number
  attendanceTotal: number
  feedbackCount: number
  averageRating: number | null
  certificatesIssued: number
  attendanceLocked: boolean
}

export interface AuditCertificateRow {
  id: string
  recipientName: string | null
  recipientEmail: string | null
  sessionTitle: string
  departmentName: string
  certificateRole: string
  certificateCode: string
  issuedAt: string
}

export interface AuditMemberSummary {
  totalMembers: number
  admins: number
  faculty: number
  trainees: number
  pendingJoinRequests: number
}

export interface AuditMemberRow {
  user_id: string
  email: string
  full_name: string | null
  grade: string | null
  role: string
  sessions_attended: number
  sessions_total: number
  attendance_pct: number
}

export interface AuditPageData {
  stats: AuditSummaryStats
  recentSessions: AuditSessionRow[]
  certificates: AuditCertificateRow[]
  memberSummary: AuditMemberSummary
  memberDetails: AuditMemberRow[]
  departmentNames: { id: string; name: string }[]
}

function groupBy<T extends Record<string, unknown>>(
  arr: T[],
  key: keyof T
): Record<string, T[]> {
  return arr.reduce(
    (acc, item) => {
      const k = String(item[key])
      if (!acc[k]) acc[k] = []
      acc[k].push(item)
      return acc
    },
    {} as Record<string, T[]>
  )
}

export async function getAuditPageData(): Promise<AuditPageData> {
  await requireAuth()
  const orgId = await requireOrg()

  const orgAdmin = await isOrgAdmin()
  const superAdmin = await isSuperAdmin()

  let departmentIds: string[] = []
  let departmentNames: { id: string; name: string }[] = []

  if (orgAdmin || superAdmin) {
    const allDepts = await getDepartments()
    departmentIds = allDepts.map((d) => d.id)
    departmentNames = allDepts.map((d) => ({ id: d.id, name: d.name }))
  } else {
    const moderatedDepts = await getMyModeratedDepartments()
    if (moderatedDepts.length === 0) {
      throw new Error('No audit access')
    }
    departmentIds = moderatedDepts.map((d) => d.id)
    departmentNames = moderatedDepts
  }

  const [stats, recentSessions, certificates, memberRoles, pendingJoinRequests, memberDetails] =
    await Promise.all([
      computeStats(orgId, departmentIds),
      buildRecentSessions(orgId, departmentIds),
      buildCertificates(departmentIds),
      auditDb.listDepartmentMemberRoles(departmentIds),
      auditDb.countPendingJoinRequestsForDepartments(departmentIds),
      auditDb.listMemberAttendanceDetails(orgId, departmentIds),
    ])

  const memberSummary: AuditMemberSummary = {
    totalMembers: memberRoles.length,
    admins: memberRoles.filter(
      (m) => m.role === 'department_admin' || m.role === 'org_admin'
    ).length,
    faculty: memberRoles.filter((m) => m.role === 'faculty').length,
    trainees: memberRoles.filter((m) => m.role === 'trainee').length,
    pendingJoinRequests,
  }

  return {
    stats,
    recentSessions,
    certificates,
    memberSummary,
    memberDetails,
    departmentNames,
  }
}

async function computeStats(
  orgId: string,
  departmentIds: string[]
): Promise<AuditSummaryStats> {
  const sessionIds = await auditDb.listPublishedSessionIds(orgId, departmentIds)
  const totalSessions = sessionIds.length

  if (totalSessions === 0) {
    return {
      totalSessions: 0,
      averageAttendanceRate: 0,
      averageFeedbackRating: 0,
      certificatesIssued: 0,
    }
  }

  const [attendance, feedback, certificatesIssued] = await Promise.all([
    auditDb.listAttendanceStatusesForSessions(sessionIds),
    auditDb.listFeedbackRatingsForSessions(sessionIds),
    auditDb.countCertificatesForDepartments(departmentIds),
  ])

  const presentCount = attendance.filter(
    (a) => a.status === 'PRESENT' || a.status === 'LATE'
  ).length
  const attendanceRate =
    attendance.length > 0 ? Math.round((presentCount / attendance.length) * 100) : 0

  const ratings = feedback
    .map((f) => f.rating)
    .filter((r): r is number => typeof r === 'number')
  const avgRating =
    ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
      : 0

  return {
    totalSessions,
    averageAttendanceRate: attendanceRate,
    averageFeedbackRating: avgRating,
    certificatesIssued,
  }
}

async function buildRecentSessions(
  orgId: string,
  departmentIds: string[]
): Promise<AuditSessionRow[]> {
  const sessions = await auditDb.listRecentPublishedSessions(orgId, departmentIds)
  if (sessions.length === 0) return []

  const sessionIds = sessions.map((s) => s.id)

  const [attendance, feedback, certificates] = await Promise.all([
    auditDb.listAttendanceStatusesForSessions(sessionIds),
    auditDb.listFeedbackRatingsForSessions(sessionIds),
    auditDb.listCertificateSessionIds(sessionIds),
  ])

  const attendanceBySession = groupBy(attendance, 'session_id')
  const feedbackBySession = groupBy(feedback, 'session_id')
  const certsBySession = groupBy(certificates, 'session_id')

  return sessions.map((s) => {
    const att = attendanceBySession[s.id] || []
    const fb = feedbackBySession[s.id] || []
    const certs = certsBySession[s.id] || []

    const presentCount = att.filter(
      (a) => a.status === 'PRESENT' || a.status === 'LATE'
    ).length

    const ratings = fb
      .map((f) => f.rating)
      .filter((r): r is number => typeof r === 'number')
    const avgRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
        : null

    return {
      id: s.id,
      title: s.title,
      dateStart: s.date_start,
      status: s.status,
      departmentName: s.department_name,
      attendancePresent: presentCount,
      attendanceTotal: att.length,
      feedbackCount: fb.length,
      averageRating: avgRating,
      certificatesIssued: certs.length,
      attendanceLocked: s.attendance_locked,
    }
  })
}

async function buildCertificates(
  departmentIds: string[]
): Promise<AuditCertificateRow[]> {
  const rows = await auditDb.listCertificatesForDepartments(departmentIds)

  // Resolve emails for certificates that have a user_id but no recipient_name.
  // This sits on the auth plane (GoTrue admin API) so it stays on a direct
  // Supabase client until the auth provider swap.
  const userIds = rows
    .filter((c) => c.user_id && !c.recipient_name)
    .map((c) => c.user_id as string)

  let userEmails: Record<string, string> = {}
  if (userIds.length > 0) {
    const uniqueUserIds = Array.from(new Set(userIds))
    const supabase = await createSupabaseServiceClient()
    const results = await Promise.all(
      uniqueUserIds.map(async (uid) => {
        const { data: userData } = await supabase.auth.admin.getUserById(uid)
        return { id: uid, email: userData?.user?.email || null }
      })
    )
    userEmails = results.reduce(
      (acc, u) => {
        if (u.email) acc[u.id] = u.email
        return acc
      },
      {} as Record<string, string>
    )
  }

  return rows.map((c) => ({
    id: c.id,
    recipientName: c.recipient_name,
    recipientEmail: c.user_id ? userEmails[c.user_id] || null : null,
    sessionTitle: c.session_title,
    departmentName: c.department_name,
    certificateRole: c.certificate_role,
    certificateCode: c.certificate_code,
    issuedAt: c.issued_at,
  }))
}

export async function generateAuditReportPDF(
  dateFrom?: string,
  dateTo?: string
): Promise<{ base64: string; filename: string }> {
  const data = await getAuditPageData()

  // Filter sessions by date range
  let sessions = data.recentSessions
  if (dateFrom) sessions = sessions.filter((s) => s.dateStart >= dateFrom)
  if (dateTo) sessions = sessions.filter((s) => s.dateStart <= dateTo + 'T23:59:59')

  // Build a simple text-based PDF using @react-pdf/renderer
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { buildAuditReportDocument } = await import('@/lib/audit-report/pdf')

  const buffer = await renderToBuffer(
    buildAuditReportDocument({
      departmentNames: data.departmentNames.map((d) => d.name),
      sessions,
      dateFrom,
      dateTo,
    })
  )

  const base64 = Buffer.from(buffer).toString('base64')
  const dateLabel = [dateFrom, dateTo].filter(Boolean).join('_to_') || 'all-time'
  return { base64, filename: `audit-report-${dateLabel}.pdf` }
}

export async function generateMemberAttendanceReportPDF(
  userId: string
): Promise<{ base64: string; filename: string }> {
  await requireAuth()
  const orgId = await requireOrg()

  const orgAdmin = await isOrgAdmin()
  const superAdmin = await isSuperAdmin()

  let departmentIds: string[] = []
  let departmentNames: string[] = []

  if (orgAdmin || superAdmin) {
    const allDepts = await getDepartments()
    departmentIds = allDepts.map((d) => d.id)
    departmentNames = allDepts.map((d) => d.name)
  } else {
    const moderatedDepts = await getMyModeratedDepartments()
    departmentIds = moderatedDepts.map((d) => d.id)
    departmentNames = moderatedDepts.map((d) => d.name)
  }

  // Get member profile
  const profile = await onboardingDb.findProfileByUserId(userId)

  const memberName = profile?.full_name || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || userId

  // Get past published sessions + this member's attendance rows
  const sessions = await auditDb.listPastPublishedSessionsMeta(orgId, departmentIds)
  const attendance = await auditDb.listMemberAttendanceRows(
    userId,
    sessions.map((s) => s.id)
  )
  const attendanceMap = new Map<string, { status: string; source: string | null }>(
    attendance.map((a) => [a.session_id, { status: a.status, source: a.primary_source }])
  )

  const sessionRows = (sessions ?? []).map((s) => {
    const att = attendanceMap.get(s.id)
    return {
      title: s.title,
      date: s.date_start,
      status: att?.status ?? 'ABSENT',
      source: att?.source ?? null,
    }
  })

  const attended = sessionRows.filter((s) => s.status === 'PRESENT' || s.status === 'LATE').length
  const total = sessionRows.length
  const pct = total > 0 ? Math.round((attended / total) * 100) : 0

  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { buildMemberReportDocument } = await import('@/lib/audit-report/pdf')

  const buffer = await renderToBuffer(
    buildMemberReportDocument({
      memberName,
      email: profile?.email ?? '',
      grade: profile?.grade ?? null,
      departmentNames,
      attended,
      total,
      pct,
      sessions: sessionRows,
    })
  )

  const base64 = Buffer.from(buffer).toString('base64')
  const safeName = memberName.replace(/\s+/g, '-').toLowerCase()
  return { base64, filename: `attendance-${safeName}.pdf` }
}
