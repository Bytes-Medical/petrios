'use server'

import * as rotaDb from '@/lib/db/rota'
import {
  RotaAccessError,
  requireRotaModerator,
  requireRotaModeratorForCleanup,
  toRotaFailure,
} from '@/lib/rota/access'
import { getRotaIdentitySecret } from '@/lib/rota/config'
import { rotaKeyHmac } from '@/lib/rota/identity'
import { normaliseEmail, normaliseStaffKey } from '@/lib/rota/identity-normalise'
import type { RotaLinkedStaffRow, RotaResult } from '@/lib/rota/types'

/**
 * "Linked staff" (spec/14): rota moderators review, add and revoke the
 * identity links of CURRENT trainees of their department. Links carry a
 * keyed hash only; this surface shows the key type, origin and confirmation
 * date, never the hash or the identifier.
 *
 * Adding a link here (a staff number and/or email typed by the moderator for
 * a chosen trainee) lets new starters be matched after a changeover without
 * the rota export ever being passed to the moderator. Revoking is deletion
 * only and works even with the kill switch off.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listRotaLinkedStaff(departmentId: string): Promise<RotaResult<RotaLinkedStaffRow[]>> {
  try {
    if (!UUID.test(String(departmentId))) throw new RotaAccessError('forbidden')
    const { orgId } = await requireRotaModerator(departmentId)
    const trainees = await rotaDb.listDepartmentTrainees(orgId, departmentId)
    const names = new Map(trainees.map((t) => [t.userId, t.displayName]))
    const links = await rotaDb.listLinksForUsers(orgId, trainees.map((t) => t.userId))
    const rows: RotaLinkedStaffRow[] = links
      .filter((link) => names.has(link.userId))
      .map((link) => ({ ...link, displayName: names.get(link.userId) ?? 'Unknown trainee' }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.keyType.localeCompare(b.keyType))
    return { ok: true, data: rows }
  } catch (error) {
    return toRotaFailure(error, 'linked staff')
  }
}

/**
 * A moderator links one current trainee to the staff number and/or email the
 * rota uses for them. Both are normalised exactly like the upload (the
 * assignment-suffix rule must match the department's upload profile), hashed
 * with the keyed HMAC and never stored or logged in clear.
 */
export async function linkRotaIdentity(input: {
  departmentId: string
  userId: string
  staffNumber?: string
  email?: string
  stripAssignmentSuffix?: boolean
}): Promise<RotaResult<{ linked: number; refused: number }>> {
  try {
    const departmentId = String(input?.departmentId ?? '')
    if (!UUID.test(departmentId)) throw new RotaAccessError('forbidden')
    const { orgId, userId: actorUserId } = await requireRotaModerator(departmentId)
    const userId = String(input?.userId ?? '')
    if (!UUID.test(userId)) return { ok: false, message: 'Choose a trainee.', code: 'not_eligible' }

    const rawStaff = typeof input?.staffNumber === 'string' ? input.staffNumber.trim() : ''
    const rawEmail = typeof input?.email === 'string' ? input.email.trim() : ''
    if (!rawStaff && !rawEmail) return { ok: false, message: 'Enter a staff number or an email address.' }
    const staffKey = rawStaff ? normaliseStaffKey(rawStaff, { stripAssignmentSuffix: input?.stripAssignmentSuffix === true }) : null
    if (rawStaff && !staffKey) {
      return { ok: false, message: 'The staff number can use only letters, digits and . _ / - (up to 64 characters).' }
    }
    const email = rawEmail ? normaliseEmail(rawEmail) : null
    if (rawEmail && !email) return { ok: false, message: 'Enter a valid email address.' }

    const secret = getRotaIdentitySecret()
    if (!secret) throw new RotaAccessError('unavailable')
    const links: { keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string }[] = []
    if (staffKey) links.push({ keyType: 'STAFF_ID', keyHmac: rotaKeyHmac(secret, orgId, 'STAFF_ID', staffKey) })
    if (email) links.push({ keyType: 'EMAIL', keyHmac: rotaKeyHmac(secret, orgId, 'EMAIL', email) })

    const result = await rotaDb.linkRotaIdentity({ orgId, departmentId, actorUserId, userId, links })
    if (result.linked === 0) {
      return {
        ok: false,
        message: 'Not linked: that staff number or email is already linked to a trainee of another department.',
        code: 'link_refused',
      }
    }
    return { ok: true, data: result }
  } catch (error) {
    return toRotaFailure(error, 'link identity')
  }
}

export async function revokeRotaLink(departmentId: string, linkId: string): Promise<RotaResult<void>> {
  try {
    if (!UUID.test(String(departmentId))) throw new RotaAccessError('forbidden')
    // Deletion only: works with the kill switch off (spec/14).
    const { orgId } = await requireRotaModeratorForCleanup(departmentId)
    if (!UUID.test(String(linkId))) return { ok: false, message: 'Link not found.', code: 'not_found' }
    const trainees = await rotaDb.listDepartmentTrainees(orgId, departmentId)
    const links = await rotaDb.listLinksForUsers(orgId, trainees.map((t) => t.userId))
    if (!links.some((link) => link.id === linkId)) {
      return { ok: false, message: 'Link not found.', code: 'not_found' }
    }
    await rotaDb.revokeLink({ orgId, linkId })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'revoke link')
  }
}
