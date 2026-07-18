import { getServiceDb } from './client'
import { toDbError } from './errors'

export async function countRecentAttempts(input: {
  sessionId: string
  userId: string
  ipHash: string | null
  sinceIso: string
}): Promise<{ userCount: number; ipCount: number }> {
  const db = await getServiceDb()
  const userQuery = db
    .from('attendance_code_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', input.sessionId)
    .eq('user_id', input.userId)
    .gte('attempted_at', input.sinceIso)
  const ipQuery = input.ipHash
    ? db
        .from('attendance_code_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', input.sessionId)
        .eq('ip_hash', input.ipHash)
        .gte('attempted_at', input.sinceIso)
    : Promise.resolve({ count: 0, error: null })
  const [userResult, ipResult] = await Promise.all([userQuery, ipQuery])
  if (userResult.error) throw toDbError('Failed to count group-code attempts', userResult.error)
  if (ipResult.error) throw toDbError('Failed to count group-code attempts', ipResult.error)
  return { userCount: userResult.count ?? 0, ipCount: ipResult.count ?? 0 }
}
export async function recordAttempt(input: {
  sessionId: string
  userId: string
  ipHash: string | null
}): Promise<number> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('attendance_code_attempts')
    .insert({ session_id: input.sessionId, user_id: input.userId, ip_hash: input.ipHash })
    .select('id')
    .single()
  if (error) throw toDbError('Failed to record group-code attempt', error)
  return Number(data.id)
}

export async function markAttemptSuccessful(id: number): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db.from('attendance_code_attempts').update({ successful: true }).eq('id', id)
  if (error) throw toDbError('Failed to complete group-code attempt', error)
}
