import type { AttendanceStatus, SessionType } from '@/lib/types'
import { getServiceDb } from './client'
import { toDbError } from './errors'

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SessionWithDetails {
  id: string
  title: string
  date_start: string
  date_end: string
  location_type: string
  session_type: SessionType | null
  department_name: string
  department_id: string
  teacher_names: string[]
  my_attendance_status: AttendanceStatus | null
}

export interface FeedbackHistoryEntry {
  id: string
  session_id: string
  session_title: string
  session_date: string
  department_name: string
  rating: number | null
  comment: string | null
  answers: unknown[]
  submitted_at: string
}

export interface AttendanceLogEntry {
  session_id: string
  session_title: string
  session_date: string
  status: AttendanceStatus
  primary_source: string | null
}

export interface AttendanceSummary {
  total_sessions: number
  attended: number
  attendance_pct: number
  current_streak: number
  sessions: AttendanceLogEntry[]
}

// -----------------------------------------------------------------------------
// Sessions for user's departments
// -----------------------------------------------------------------------------

export async function listSessionsForUserDepartments(
  userId: string,
  orgId: string
): Promise<{ upcoming: SessionWithDetails[]; past: SessionWithDetails[] }> {
  const db = await getServiceDb()

  // Get departments the user belongs to
  const { data: memberships, error: memError } = await db
    .from('department_members')
    .select('department_id')
    .eq('user_id', userId)
    .eq('org_id', orgId)

  if (memError) throw toDbError('Failed to fetch department memberships', memError)
  if (!memberships || memberships.length === 0) return { upcoming: [], past: [] }

  const deptIds = memberships.map((m) => m.department_id)

  // Get published sessions for those departments
  const { data: sessions, error: sessError } = await db
    .from('sessions')
    .select(
      'id, title, date_start, date_end, location_type, session_type, department_id, departments:department_id(name)'
    )
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .in('department_id', deptIds)
    .order('date_start', { ascending: true })

  if (sessError) throw toDbError('Failed to fetch sessions', sessError)
  if (!sessions || sessions.length === 0) return { upcoming: [], past: [] }

  const sessionIds = sessions.map((s) => s.id)

  // Fetch teachers for all sessions
  const { data: teacherRows } = await db
    .from('session_teachers')
    .select('session_id, user_id, profiles:user_id(full_name, first_name, last_name)')
    .in('session_id', sessionIds)

  const teacherMap = new Map<string, string[]>()
  if (teacherRows) {
    for (const t of teacherRows) {
      const profile = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles
      const name =
        profile?.full_name ||
        [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
        'Unknown'
      const list = teacherMap.get(t.session_id) || []
      list.push(name)
      teacherMap.set(t.session_id, list)
    }
  }

  // Fetch attendance for this user
  const { data: attendanceRows } = await db
    .from('attendance')
    .select('session_id, status')
    .eq('user_id', userId)
    .in('session_id', sessionIds)

  const attendanceMap = new Map<string, AttendanceStatus>()
  if (attendanceRows) {
    for (const a of attendanceRows) {
      attendanceMap.set(a.session_id, a.status as AttendanceStatus)
    }
  }

  const now = new Date().toISOString()
  const upcoming: SessionWithDetails[] = []
  const past: SessionWithDetails[] = []

  for (const s of sessions) {
    const dept = Array.isArray(s.departments) ? s.departments[0] : s.departments
    const entry: SessionWithDetails = {
      id: s.id,
      title: s.title,
      date_start: s.date_start,
      date_end: s.date_end,
      location_type: s.location_type,
      session_type: s.session_type as SessionType | null,
      department_name: dept?.name ?? '',
      department_id: s.department_id,
      teacher_names: teacherMap.get(s.id) || [],
      my_attendance_status: attendanceMap.get(s.id) || null,
    }

    if (s.date_start > now) {
      upcoming.push(entry)
    } else {
      past.push(entry)
    }
  }

  past.reverse() // most recent first

  return { upcoming, past }
}

// -----------------------------------------------------------------------------
// Feedback history
// -----------------------------------------------------------------------------

export async function listFeedbackByUser(
  userId: string,
  orgId: string
): Promise<FeedbackHistoryEntry[]> {
  const db = await getServiceDb()

  const { data, error } = await db
    .from('session_feedback')
    .select(
      'id, session_id, rating, comment, answers, created_at, sessions:session_id(title, date_start, department_id, departments:department_id(name))'
    )
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw toDbError('Failed to fetch feedback history', error)
  if (!data) return []

  return data.map((row) => {
    const session = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions
    const dept = session?.departments
      ? Array.isArray(session.departments)
        ? session.departments[0]
        : session.departments
      : null

    return {
      id: row.id,
      session_id: row.session_id,
      session_title: session?.title ?? '',
      session_date: session?.date_start ?? '',
      department_name: dept?.name ?? '',
      rating: row.rating,
      comment: row.comment,
      answers: Array.isArray(row.answers) ? row.answers : [],
      submitted_at: row.created_at,
    }
  })
}

// -----------------------------------------------------------------------------
// Attendance summary
// -----------------------------------------------------------------------------

export async function getAttendanceSummaryForUser(
  userId: string,
  orgId: string
): Promise<AttendanceSummary> {
  const db = await getServiceDb()

  // Get user's department IDs
  const { data: memberships } = await db
    .from('department_members')
    .select('department_id')
    .eq('user_id', userId)
    .eq('org_id', orgId)

  const deptIds = (memberships || []).map((m) => m.department_id)

  if (deptIds.length === 0) {
    return { total_sessions: 0, attended: 0, attendance_pct: 0, current_streak: 0, sessions: [] }
  }

  // Get all published past sessions in user's departments
  const now = new Date().toISOString()
  const { data: sessions } = await db
    .from('sessions')
    .select('id, title, date_start')
    .eq('org_id', orgId)
    .eq('status', 'PUBLISHED')
    .in('department_id', deptIds)
    .lte('date_start', now)
    .order('date_start', { ascending: false })

  if (!sessions || sessions.length === 0) {
    return { total_sessions: 0, attended: 0, attendance_pct: 0, current_streak: 0, sessions: [] }
  }

  const sessionIds = sessions.map((s) => s.id)

  // Get attendance records for this user
  const { data: attendanceRows } = await db
    .from('attendance')
    .select('session_id, status, primary_source')
    .eq('user_id', userId)
    .in('session_id', sessionIds)

  const attendanceMap = new Map<string, { status: string; primary_source: string | null }>()
  if (attendanceRows) {
    for (const a of attendanceRows) {
      attendanceMap.set(a.session_id, { status: a.status, primary_source: a.primary_source })
    }
  }

  const total_sessions = sessions.length
  let attended = 0
  let current_streak = 0
  let streakBroken = false

  const logEntries: AttendanceLogEntry[] = sessions.map((s) => {
    const record = attendanceMap.get(s.id)
    const status = (record?.status ?? 'ABSENT') as AttendanceStatus

    if (status === 'PRESENT' || status === 'LATE') {
      attended++
      if (!streakBroken) current_streak++
    } else {
      streakBroken = true
    }

    return {
      session_id: s.id,
      session_title: s.title,
      session_date: s.date_start,
      status,
      primary_source: record?.primary_source ?? null,
    }
  })

  const attendance_pct = total_sessions > 0 ? Math.round((attended / total_sessions) * 100) : 0

  return {
    total_sessions,
    attended,
    attendance_pct,
    current_streak,
    sessions: logEntries,
  }
}
