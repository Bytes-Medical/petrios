import { getServiceDb } from './client'
import { toDbError } from './errors'

/** Service access: setup-code gate or super-admin gate enforced by callers. */
export async function getInstallationState() {
  const db = await getServiceDb()
  const { data, error } = await db.from('instance_setup').select('blocked,completed_at').eq('singleton', true).single()
  if (error) throw toDbError('Installation state unavailable', error)
  return data as { blocked: boolean; completed_at: string | null }
}

/** Service access: only after validating the private setup code. */
export async function reserveInstallation(email: string): Promise<string> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('reserve_instance_setup', { p_email: email })
  if (error) throw toDbError('Setup is unavailable or reserved for another administrator', error)
  return data as string
}

/** Service access: server-generated bootstrap reservation, never supplied by the browser. */
export async function completeInstallation(reservation: string, userId: string, org: string, department: string) {
  const db = await getServiceDb()
  const { error } = await db.rpc('complete_instance_setup', { p_reservation: reservation, p_user: userId, p_org: org, p_department: department })
  if (error) throw toDbError('Could not complete setup. Retry with the same administrator email.', error)
}

/** Service access: installation owner sees operational status, never tenant records. */
export async function listInstallationJobs() {
  const db = await getServiceDb()
  const { data, error } = await db.from('instance_jobs').select('name,last_success,last_error').order('name')
  if (error) throw toDbError('Scheduler state unavailable', error)
  return data as { name: string; last_success: string | null; last_error: string | null }[]
}

/** Service access: authenticated scheduler only. */
export async function claimInstallationJob(name: string): Promise<string | null> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('claim_instance_job', { p_name: name })
  if (error) throw toDbError('Could not claim scheduled job', error)
  return data as string | null
}

/** Service access: compare the lease so a stale worker cannot acknowledge a new run. */
export async function finishInstallationJob(name: string, lease: string, success: boolean) {
  const db = await getServiceDb()
  const { error } = await db.from('instance_jobs').update({
    lease: null, lease_until: null, last_error: success ? null : 'Job failed; check server logs',
    ...(success ? { last_success: new Date().toISOString() } : {}),
  }).eq('name', name).eq('lease', lease)
  if (error) throw toDbError('Could not record scheduled job result', error)
}
