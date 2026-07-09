import { requireAuth, requireOrg, requireOrgManager } from '@/lib/auth'

/**
 * The auth gate every interactive Bytes Ops entry point goes through:
 * authenticated + in an org + org manager (org admin or department admin).
 * Returns the caller's identity so actions can scope queries to it — org
 * scope always comes from here, never from client or model input.
 */
export async function requireOpsManager(): Promise<{ userId: string; orgId: string }> {
  const userId = await requireAuth()
  const orgId = await requireOrg()
  await requireOrgManager(orgId)
  return { userId, orgId }
}
