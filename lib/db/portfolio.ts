import { getServiceDb } from './client'
import { toDbError } from './errors'

/**
 * Portfolio packs + dossier reads. Service-role by necessity:
 * portfolio_packs is deny-all RLS (the public verify page must read packs
 * with no session), and dossier aggregation spans attendance rows across
 * users. Callers are self-scoped actions (requireAuth, own userId only) and
 * the public verify page (capability code lookup).
 */

export interface PortfolioPack {
  id: string
  org_id: string
  user_id: string
  period_start: string
  period_end: string
  pack_code: string
  payload: Record<string, unknown>
  created_at: string
}

export async function insertPortfolioPack(input: {
  orgId: string
  userId: string
  periodStart: string
  periodEnd: string
  packCode: string
  payload: Record<string, unknown>
}): Promise<PortfolioPack> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('portfolio_packs')
    .insert({
      org_id: input.orgId,
      user_id: input.userId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      pack_code: input.packCode,
      payload: input.payload,
    })
    .select('*')
    .single()

  if (error) throw toDbError('Failed to create portfolio pack', error)
  return data as PortfolioPack
}

export async function findPackByCode(packCode: string): Promise<PortfolioPack | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('portfolio_packs')
    .select('*')
    .eq('pack_code', packCode)
    .maybeSingle()

  if (error) throw toDbError('Failed to fetch portfolio pack', error)
  return (data as PortfolioPack | null) ?? null
}

export interface TaughtSessionRow {
  session_id: string
  title: string
  date_start: string
  date_end: string
  department_id: string
}

/** Sessions this user taught (ACCEPTED) whose start falls in [start, end). */
export async function listTaughtSessionsInPeriod(
  userId: string,
  orgId: string,
  startIso: string,
  endIso: string
): Promise<TaughtSessionRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('session_teachers')
    .select('session_id, sessions:session_id (id, title, date_start, date_end, department_id, status, org_id)')
    .eq('user_id', userId)
    .eq('status', 'ACCEPTED')

  if (error) throw toDbError('Failed to list taught sessions', error)

  type Row = {
    session_id: string
    sessions:
      | { id: string; title: string; date_start: string; date_end: string; department_id: string; status: string; org_id: string }
      | { id: string; title: string; date_start: string; date_end: string; department_id: string; status: string; org_id: string }[]
      | null
  }

  const rows: TaughtSessionRow[] = []
  for (const row of (data as Row[] | null) ?? []) {
    const s = Array.isArray(row.sessions) ? row.sessions[0] : row.sessions
    if (!s || s.org_id !== orgId || s.status !== 'PUBLISHED') continue
    if (s.date_start < startIso || s.date_start >= endIso) continue
    rows.push({
      session_id: s.id,
      title: s.title,
      date_start: s.date_start,
      date_end: s.date_end,
      department_id: s.department_id,
    })
  }
  return rows.sort((a, b) => a.date_start.localeCompare(b.date_start))
}

/** session_id -> count of PRESENT/LATE attendance rows. */
export async function countAttendeesForSessions(
  sessionIds: string[]
): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map()
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance')
    .select('session_id, status')
    .in('session_id', sessionIds)
    .in('status', ['PRESENT', 'LATE'])

  if (error) throw toDbError('Failed to count attendees', error)
  const counts = new Map<string, number>()
  for (const row of (data as { session_id: string }[] | null) ?? []) {
    counts.set(row.session_id, (counts.get(row.session_id) ?? 0) + 1)
  }
  return counts
}
