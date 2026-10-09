import { getInstallationState } from '@/lib/db/installation'
import { pingDatabase } from '@/lib/db/organizations'
import { getPublicRuntimeConfig } from '@/lib/runtime-config'

export async function installationReadiness() {
  const config = getPublicRuntimeConfig()
  const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '', Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}` }
  const probe = async (url: string) => {
    try { return (await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(4000) })).ok }
    catch { return false }
  }
  const [database, schema, auth, storage] = await Promise.all([
    pingDatabase().catch(() => false),
    getInstallationState().then(() => true, () => false),
    probe(`${process.env.AUTH_INTERNAL_URL || `${config.supabaseUrl}/auth/v1`}/health`),
    probe(`${process.env.STORAGE_INTERNAL_URL || `${config.supabaseUrl}/storage/v1`}/status`),
  ])
  return { database, schema, auth, storage }
}
