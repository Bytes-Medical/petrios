import { createHmac } from 'node:crypto'

/**
 * Keyed identity hash (spec/14). Server-only (node:crypto, supported on
 * Workers with nodejs_compat). The identifier itself is never stored or
 * logged; links hold only this HMAC, scoped per organisation and key type:
 *
 *   hex HMAC-SHA256(ROTA_IDENTITY_SECRET,
 *                   'petrios-rota-id/v1|' + orgId + '|' + keyType + '|' + normalised)
 *
 * Rotating ROTA_IDENTITY_SECRET orphans every link (moderators re-link).
 */
export function rotaKeyHmac(
  secret: Uint8Array,
  orgId: string,
  keyType: 'STAFF_ID' | 'EMAIL',
  normalised: string
): string {
  return createHmac('sha256', secret)
    .update(`petrios-rota-id/v1|${orgId}|${keyType}|${normalised}`, 'utf8')
    .digest('hex')
}

/**
 * Proof that one row was part of an upload's match preview (spec/14, the
 * membership-oracle bound). Returned to an uploader's browser with the
 * preview and checked on every submitted row, so the upload itself can only
 * carry identifiers the caller has already spent their one preview on:
 *
 *   hex HMAC-SHA256(ROTA_IDENTITY_SECRET, 'petrios-rota-preview/v1|' + orgId
 *     + '|' + departmentId + '|' + uploadId + '|' + callerUserId + '|' + ref
 *     + '|' + staffKey + '|' + email), first 32 hex characters.
 *
 * Never stored. The identifiers are already normalised.
 */
export function rotaPreviewRowProof(
  secret: Uint8Array,
  scope: { orgId: string; departmentId: string; uploadId: string; callerUserId: string },
  row: { ref: string; staffKey?: string; email?: string }
): string {
  return createHmac('sha256', secret)
    .update(
      [
        'petrios-rota-preview/v1',
        scope.orgId,
        scope.departmentId,
        scope.uploadId,
        scope.callerUserId,
        row.ref,
        row.staffKey ?? '',
        row.email ?? '',
      ].join('|'),
      'utf8'
    )
    .digest('hex')
    .slice(0, 32)
}

/**
 * The keyed digest stored on the batch audit row (12 months) instead of a
 * plain SHA-256, so a small batch cannot be brute-forced offline from a
 * database copy or backup (staff number + leave days):
 *
 *   hex HMAC-SHA256(ROTA_IDENTITY_SECRET, 'petrios-rota-batch/v1|' + orgId + '|' + sha256)
 */
export function rotaBatchDigest(secret: Uint8Array, orgId: string, sha256: string): string {
  return createHmac('sha256', secret).update(`petrios-rota-batch/v1|${orgId}|${sha256}`, 'utf8').digest('hex')
}
