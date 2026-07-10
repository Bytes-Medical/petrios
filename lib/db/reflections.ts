import { getDb } from './client'
import { toDbError } from './errors'

export interface SessionReflection {
  id: string
  org_id: string
  session_id: string
  user_id: string
  body: string
  created_at: string
  updated_at: string
}

/** RLS-scoped: users only ever see and write their own reflections. */
export async function listMyReflections(userId: string): Promise<SessionReflection[]> {
  const db = await getDb()
  const { data, error } = await db
    .from('session_reflections')
    .select('*')
    .eq('user_id', userId)

  if (error) throw toDbError('Failed to list reflections', error)
  return (data as SessionReflection[] | null) ?? []
}

export async function upsertMyReflection(input: {
  orgId: string
  sessionId: string
  userId: string
  body: string
}): Promise<void> {
  const db = await getDb()
  const { error } = await db.from('session_reflections').upsert(
    {
      org_id: input.orgId,
      session_id: input.sessionId,
      user_id: input.userId,
      body: input.body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id,user_id' }
  )

  if (error) throw toDbError('Failed to save reflection', error)
}
