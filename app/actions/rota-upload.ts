'use server'

import { DbConflictError, DbNotFoundError } from '@/lib/db'
import * as rotaDb from '@/lib/db/rota'
import { appDayKey, appWallClockToIso, formatAppDateTime } from '@/lib/datetime'
import {
  getRotaAvailability,
  RotaAccessError,
  requireRotaUploaderOrModerator,
  ROTA_RPC_MESSAGES,
  toRotaFailure,
} from '@/lib/rota/access'
import { canonicalRotaJson, sha256Hex } from '@/lib/rota/canonical'
import { getRotaIdentitySecret } from '@/lib/rota/config'
import { rotaBatchDigest, rotaKeyHmac, rotaPreviewRowProof } from '@/lib/rota/identity'
import { computeRotaIngest } from '@/lib/rota/ingest'
import { resolveRotaPeople, type RotaKeyType } from '@/lib/rota/matching'
import { rotaProfileConfigSchema } from '@/lib/rota/profile'
import { addDaysToKey, REF_PATTERN, ROTA_LIMITS, STAFF_KEY_PATTERN, validateRotaBatch } from '@/lib/rota/schema'
import type {
  RotaBatchPerson,
  RotaIngestResult,
  RotaMatchPreview,
  RotaResult,
  RotaUploadContext,
  RotaUploadSummary,
} from '@/lib/rota/types'

/**
 * Rota upload actions (spec/14). Callers: department rota moderators and
 * holders of the narrow rota_uploaders grant (requireRotaUploaderOrModerator).
 *
 * The browser has already turned the export into the minimised payload; this
 * module validates it strictly, hashes identifiers with the keyed HMAC, keeps
 * only CURRENT trainees of the department, computes session flags and hands
 * the RPC user ids, HMACs and flag keys only. Staff numbers and emails are
 * used in memory for this request and never stored or logged. Request bodies
 * are never logged: only codes and counts.
 *
 * Membership oracle bound (spec/14): an upload is tied to its one match
 * preview (upload id). The ingest RPC refuses a batch without that preview
 * and more than one batch per kind per upload, and an uploader's rows must
 * each carry the preview's row proof, so the upload can only contain
 * identifiers the caller already spent their preview on. An uploader's
 * result carries counts only, never what moderators or trainees decided.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256 = /^[0-9a-f]{64}$/
const PROOF = /^[0-9a-f]{32}$/
/** Flag + cleared pairs one batch may write (the RPC enforces the same ceiling). */
const MAX_PAIRS = 100_000
const EMAIL = /^[^\s@A-Z]{1,64}@[^\s@A-Z]{1,253}$/
const INVALID_PAYLOAD = { ok: false as const, message: ROTA_RPC_MESSAGES.invalid_payload, code: 'invalid_payload' }

async function horizonFor(orgId: string, departmentId: string): Promise<number> {
  const availability = await getRotaAvailability(orgId, departmentId)
  if (!availability.available) throw new RotaAccessError('unavailable')
  return availability.horizonDays
}

function requireSecret(): Uint8Array {
  const secret = getRotaIdentitySecret()
  if (!secret) throw new RotaAccessError('unavailable')
  return secret
}

export async function getRotaUploadContext(departmentId: string): Promise<RotaResult<RotaUploadContext>> {
  try {
    if (!UUID.test(String(departmentId))) throw new RotaAccessError('forbidden')
    const { orgId, role } = await requireRotaUploaderOrModerator(departmentId)
    const [horizonDays, profiles, roster, worked, planned] = await Promise.all([
      horizonFor(orgId, departmentId),
      rotaDb.listUploadProfiles(orgId, departmentId),
      role === 'MODERATOR' ? rotaDb.listDepartmentTrainees(orgId, departmentId) : Promise.resolve(null),
      rotaDb.findLatestBatch({ orgId, departmentId, kind: 'WORKED' }),
      rotaDb.findLatestBatch({ orgId, departmentId, kind: 'PLANNED' }),
    ])
    return {
      ok: true,
      data: {
        callerRole: role,
        todayKey: appDayKey(),
        horizonDays,
        profiles,
        roster: roster
          ? roster
              .map((t) => ({ userId: t.userId, displayName: t.displayName, email: t.email }))
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
          : null,
        latest: {
          worked: worked ? formatAppDateTime(worked.createdAt) : null,
          planned: planned ? formatAppDateTime(planned.createdAt) : null,
        },
      },
    }
  } catch (error) {
    return toRotaFailure(error, 'upload context')
  }
}

function hmacFor(secret: Uint8Array, orgId: string) {
  return (keyType: RotaKeyType, normalised: string) => rotaKeyHmac(secret, orgId, keyType, normalised)
}

function keysOf(people: RotaBatchPerson[], hmacOf: (t: RotaKeyType, v: string) => string) {
  const keys: { keyType: RotaKeyType; keyHmac: string }[] = []
  for (const person of people) {
    if (person.staff_key) keys.push({ keyType: 'STAFF_ID', keyHmac: hmacOf('STAFF_ID', person.staff_key) })
    if (person.email) keys.push({ keyType: 'EMAIL', keyHmac: hmacOf('EMAIL', person.email) })
  }
  return keys
}

/**
 * The membership oracle (DESIGN §6): one call per upload id, at most 500
 * people, at most 10 calls per uploader per day (checked and recorded
 * atomically in the database); audited by count only. Moderators get names;
 * uploaders get booleans, plus a row proof for each matched row that the
 * upload must carry back.
 */
export async function previewRotaMatches(input: {
  departmentId: string
  uploadId: string
  people: { ref: string; staffKey?: string; email?: string }[]
}): Promise<RotaResult<RotaMatchPreview>> {
  try {
    const departmentId = String(input?.departmentId ?? '')
    if (!UUID.test(departmentId)) throw new RotaAccessError('forbidden')
    const { orgId, userId, role } = await requireRotaUploaderOrModerator(departmentId)
    const uploadId = String(input?.uploadId ?? '')
    const rawPeople = Array.isArray(input?.people) ? input.people : null
    if (!UUID.test(uploadId) || !rawPeople || rawPeople.length > ROTA_LIMITS.maxPeople) return INVALID_PAYLOAD

    const people: RotaBatchPerson[] = []
    const refs = new Set<string>()
    for (const raw of rawPeople) {
      if (!raw || typeof raw !== 'object') return INVALID_PAYLOAD
      const keys = Object.keys(raw)
      if (keys.some((k) => k !== 'ref' && k !== 'staffKey' && k !== 'email')) return INVALID_PAYLOAD
      const ref = String(raw.ref ?? '')
      if (!REF_PATTERN.test(ref) || refs.has(ref)) return INVALID_PAYLOAD
      refs.add(ref)
      const person: RotaBatchPerson = { ref, days: '' }
      if (raw.staffKey !== undefined) {
        if (typeof raw.staffKey !== 'string' || !STAFF_KEY_PATTERN.test(raw.staffKey)) return INVALID_PAYLOAD
        person.staff_key = raw.staffKey
      }
      if (raw.email !== undefined) {
        if (typeof raw.email !== 'string' || raw.email.length > 254 || !EMAIL.test(raw.email)) return INVALID_PAYLOAD
        person.email = raw.email
      }
      people.push(person)
    }

    const secret = requireSecret()
    const recorded = await rotaDb.recordMatchPreview({
      orgId,
      departmentId,
      uploadId,
      callerUserId: userId,
      callerRole: role,
      peopleCount: people.length,
      maxPerDay: ROTA_LIMITS.maxPreviewPerDay,
    })
    if (recorded === 'rate_limited') {
      return { ok: false, message: 'The daily limit for match checks is reached. Try again tomorrow.', code: 'rate_limited' }
    }
    if (recorded === 'duplicate') {
      return { ok: false, message: 'Matches for this upload were already checked. Reload the page to start a new upload.', code: 'duplicate_preview' }
    }

    const hmacOf = hmacFor(secret, orgId)
    const [trainees, links] = await Promise.all([
      rotaDb.listDepartmentTrainees(orgId, departmentId),
      rotaDb.findLinksByHmac(orgId, keysOf(people, hmacOf)),
    ])
    const resolved = resolveRotaPeople({ people, hmacOf, links, trainees, callerRole: role })
    const byRef = new Map(resolved.matched.map((m) => [m.ref, m.userId]))

    if (role === 'UPLOADER') {
      const scope = { orgId, departmentId, uploadId, callerUserId: userId }
      return {
        ok: true,
        data: {
          role: 'UPLOADER',
          rows: people.map((p) => {
            const matched = byRef.has(p.ref)
            return {
              ref: p.ref,
              matched,
              proof: matched ? rotaPreviewRowProof(secret, scope, { ref: p.ref, staffKey: p.staff_key, email: p.email }) : null,
            }
          }),
        },
      }
    }
    const names = new Map(trainees.map((t) => [t.userId, t.displayName]))
    return {
      ok: true,
      data: {
        role: 'MODERATOR',
        rows: people.map((p) => {
          const matchedUser = byRef.get(p.ref) ?? null
          return {
            ref: p.ref,
            userId: matchedUser,
            displayName: matchedUser ? names.get(matchedUser) ?? null : null,
            via: matchedUser ? resolved.via.get(p.ref) ?? null : null,
          }
        }),
      },
    }
  } catch (error) {
    return toRotaFailure(error, 'match preview')
  }
}

export async function saveRotaUploadProfile(input: {
  departmentId: string
  profileId?: string
  name: string
  config: unknown
}): Promise<RotaResult<{ profileId: string }>> {
  try {
    const departmentId = String(input?.departmentId ?? '')
    if (!UUID.test(departmentId)) throw new RotaAccessError('forbidden')
    const { orgId, userId } = await requireRotaUploaderOrModerator(departmentId)
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (name.length < 1 || name.length > 80) return { ok: false, message: 'Name the profile (up to 80 characters).' }
    if (input.profileId !== undefined && !UUID.test(String(input.profileId))) return { ok: false, message: 'Profile not found.' }
    const parsed = rotaProfileConfigSchema.safeParse(input?.config)
    if (!parsed.success) return { ok: false, message: 'The profile settings are not valid.', code: 'invalid_profile' }
    try {
      const saved = await rotaDb.saveUploadProfile({
        orgId,
        departmentId,
        id: input.profileId,
        name,
        config: parsed.data,
        actorUserId: userId,
      })
      return { ok: true, data: { profileId: saved.id } }
    } catch (error) {
      if (error instanceof DbConflictError) return { ok: false, message: 'A profile with this name already exists.' }
      if (error instanceof DbNotFoundError) return { ok: false, message: 'Profile not found.' }
      throw error
    }
  } catch (error) {
    return toRotaFailure(error, 'save profile')
  }
}

export async function deleteRotaUploadProfile(departmentId: string, profileId: string): Promise<RotaResult<void>> {
  try {
    if (!UUID.test(String(departmentId))) throw new RotaAccessError('forbidden')
    const { orgId } = await requireRotaUploaderOrModerator(departmentId)
    if (!UUID.test(String(profileId))) return { ok: false, message: 'Profile not found.' }
    await rotaDb.deleteUploadProfile({ orgId, departmentId, id: profileId })
    return { ok: true, data: undefined }
  } catch (error) {
    return toRotaFailure(error, 'delete profile')
  }
}

function summaryFor(
  role: 'MODERATOR' | 'UPLOADER',
  result: RotaIngestResult,
  counts: { peopleReceived: number; matched: number; unmatched: number; conflicts: number; newUnmatchedSinceLast: number | null }
): RotaUploadSummary {
  const { replayed, sessionsAnnotated, ...details } = result
  return {
    replayed,
    sessionsAnnotated,
    ...counts,
    // Flag inserts/deletes, decision marks and rejections reveal what
    // moderators and trainees decided: moderators only (spec/14).
    details: role === 'MODERATOR' ? details : null,
  }
}

function readProofs(input: unknown): Map<string, string> | null {
  if (input === undefined || input === null) return new Map()
  if (typeof input !== 'object' || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length > ROTA_LIMITS.maxPeople) return null
  const out = new Map<string, string>()
  for (const [ref, proof] of entries) {
    if (!REF_PATTERN.test(ref) || typeof proof !== 'string' || !PROOF.test(proof)) return null
    out.set(ref, proof)
  }
  return out
}

/**
 * One minimised batch (WORKED or PLANNED) of the upload `uploadId`. The
 * browser calls it once per batch, WORKED first, after the upload's match
 * preview. A replay of the same batch id and content returns the stored
 * counts (`replayed: true`); different content under the same id, or a second
 * batch of the same kind for the upload, is refused by the RPC.
 */
export async function submitRotaUpload(input: {
  departmentId: string
  uploadId: string
  profileId: string | null
  payloadSha256: string
  batch: unknown
  /** Uploaders: the preview's proof for every row sent, keyed by ref. */
  proofs?: Record<string, string>
  /** Rows the browser dropped as unmatched before sending (a count only). */
  notSentCount?: number
}): Promise<RotaResult<RotaUploadSummary>> {
  try {
    const departmentId = String(input?.departmentId ?? '')
    if (!UUID.test(departmentId)) throw new RotaAccessError('forbidden')
    const { orgId, userId, role } = await requireRotaUploaderOrModerator(departmentId)
    const uploadId = String(input?.uploadId ?? '')
    if (!UUID.test(uploadId)) return INVALID_PAYLOAD
    const horizonDays = await horizonFor(orgId, departmentId)
    const todayKey = appDayKey()

    const validation = validateRotaBatch(input?.batch, { todayKey, horizonDays, callerRole: role })
    if (!validation.ok) {
      const fields = [...new Set(validation.issues.map((i) => i.field))].slice(0, 10).join(',')
      console.warn(`[rota] upload rejected: ${validation.issues.length} issue(s) [${fields}]`)
      return INVALID_PAYLOAD
    }
    const batch = validation.batch
    const claimedHash = String(input?.payloadSha256 ?? '')
    if (!SHA256.test(claimedHash) || claimedHash !== (await sha256Hex(canonicalRotaJson(batch)))) {
      console.warn('[rota] upload rejected: payload hash mismatch')
      return INVALID_PAYLOAD
    }

    const notSent = input?.notSentCount ?? 0
    if (!Number.isInteger(notSent) || notSent < 0 || notSent > 20_000) return INVALID_PAYLOAD

    let profileId: string | null = null
    if (input.profileId !== null && input.profileId !== undefined) {
      if (!UUID.test(String(input.profileId))) return INVALID_PAYLOAD
      profileId = String(input.profileId)
    }

    const secret = requireSecret()
    if (!(await rotaDb.hasMatchPreview({ orgId, departmentId, uploadId, callerUserId: userId }))) {
      return { ok: false, message: ROTA_RPC_MESSAGES.preview_required, code: 'preview_required' }
    }
    if (role === 'UPLOADER') {
      // Only rows this caller already checked in this upload's one preview.
      const proofs = readProofs(input?.proofs)
      if (!proofs) return INVALID_PAYLOAD
      const scope = { orgId, departmentId, uploadId, callerUserId: userId }
      for (const person of batch.people) {
        const expected = rotaPreviewRowProof(secret, scope, { ref: person.ref, staffKey: person.staff_key, email: person.email })
        if (proofs.get(person.ref) !== expected) {
          console.warn('[rota] upload rejected: row not in the match preview')
          return INVALID_PAYLOAD
        }
      }
    }

    const hmacOf = hmacFor(secret, orgId)
    const fromIso = appWallClockToIso(`${batch.range.from}T00:00`)
    const toIso = appWallClockToIso(`${addDaysToKey(batch.range.to, 1)}T00:00`)
    const [profiles, trainees, links, sessions, previous] = await Promise.all([
      profileId ? rotaDb.listUploadProfiles(orgId, departmentId) : Promise.resolve([]),
      rotaDb.listDepartmentTrainees(orgId, departmentId),
      rotaDb.findLinksByHmac(orgId, keysOf(batch.people, hmacOf)),
      rotaDb.listRotaCandidateSessions({ orgId, departmentId, fromIso, toIso }),
      rotaDb.findLatestBatch({ orgId, departmentId, kind: batch.kind }),
    ])
    if (profileId && !profiles.some((p) => p.id === profileId)) return INVALID_PAYLOAD

    const resolved = resolveRotaPeople({ people: batch.people, hmacOf, links, trainees, callerRole: role })
    const ingest = computeRotaIngest({ batch, matched: resolved.matched, sessions })
    if (ingest.flags.length + ingest.cleared.length > MAX_PAIRS) {
      return {
        ok: false,
        message: 'This upload covers too many sessions at once. Export a shorter date range and upload it in two parts.',
        code: 'too_large',
      }
    }

    const result = await rotaDb.ingestBatch({
      orgId,
      departmentId,
      actorUserId: userId,
      batch: {
        id: batch.batch_id,
        upload_id: uploadId,
        kind: batch.kind,
        payload_digest: rotaBatchDigest(secret, orgId, claimedHash),
        range_from: batch.range.from,
        range_to: batch.range.to,
        profile_id: profileId,
        people_received: batch.people.length,
        people_matched: resolved.matched.length,
        // Server-side unmatched plus the rows the browser never sent.
        people_unmatched: resolved.unmatched + notSent,
        conflicts: resolved.conflicts,
      },
      flags: ingest.flags,
      cleared: ingest.cleared,
      links: resolved.newLinks.map((l) => ({ key_type: l.keyType, key_hmac: l.keyHmac, user_id: l.userId, origin: l.origin })),
    })

    // Unknown (null) on the first upload of this kind for the department.
    const previousUnmatched = previous ? previous.peopleUnmatched : null
    console.info(
      `[rota] batch ${result.replayed ? 'replayed' : 'ingested'}: ${batch.kind} people=${batch.people.length} matched=${resolved.matched.length}`
    )
    return {
      ok: true,
      data: summaryFor(role, result, {
        peopleReceived: batch.people.length,
        matched: resolved.matched.length,
        unmatched: resolved.unmatched,
        conflicts: resolved.conflicts,
        newUnmatchedSinceLast:
          previousUnmatched === null || result.replayed
            ? null
            : Math.max(0, resolved.unmatched + notSent - previousUnmatched),
      }),
    }
  } catch (error) {
    return toRotaFailure(error, 'upload')
  }
}
