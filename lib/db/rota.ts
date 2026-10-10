import type { Attendance } from '@/lib/types'
import type { RotaProfileConfig } from '@/lib/rota/profile'
import type {
  RotaBatchKind,
  RotaBatchRecordInput,
  RotaCandidateSession,
  RotaFlagKey,
  RotaFlagRow,
  RotaIngestResult,
  RotaLinkRow,
  RotaNewLink,
  RotaSettingsRow,
  RotaUploadProfileRow,
} from '@/lib/rota/types'
import { getServiceDb } from './client'
import { DbError, DbNotFoundError, toDbError } from './errors'

/**
 * Rota availability DAL (migration 063, spec/14).
 *
 * Every rota table is deny-all under RLS with no policies, and every rota RPC
 * is service-role only, so each function below uses the service-role client.
 * Callers MUST have authorized through `lib/rota/access.ts` (kill switch,
 * identity secret, org enabled, department enrolled, rota moderator /
 * uploader / org admin) before reaching this module. The exceptions are
 * deletion only: `purgeRotaData`, which the post-session-reports cron runs even
 * with the kill switch off (plan D9), and the cleanup actions (disable,
 * un-enrol, remove an uploader, revoke a link), which `lib/rota/access.ts`
 * authorizes by role alone so stored data can be deleted with the switch off.
 *
 * Shipping this code before 063 is applied is harmless: a missing relation or
 * function surfaces as `RotaNotInstalledError`, which callers treat as
 * "unavailable" (never a 500, never logged as an error). Identifiers in clear
 * (staff numbers, emails) never reach this module; links arrive as keyed
 * HMACs and the DAL never returns a `key_hmac` to callers outside the ingest
 * lookup.
 */

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/** 063 is not applied (missing table, view or function). Treat as unavailable. */
export class RotaNotInstalledError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: 'ROTA_NOT_INSTALLED', cause })
    this.name = 'RotaNotInstalledError'
  }
}

export type RotaRpcCode =
  | 'disabled'
  | 'invalid_payload'
  | 'batch_conflict'
  | 'not_found'
  | 'not_confirmable'
  | 'not_eligible'
  | 'suggestion_changed'
  | 'presence_evidence'
  | 'already_decided'
  | 'caught_up'
  | 'preview_required'

const ROTA_RPC_CODES: ReadonlySet<string> = new Set<RotaRpcCode>([
  'disabled',
  'invalid_payload',
  'batch_conflict',
  'not_found',
  'not_confirmable',
  'not_eligible',
  'suggestion_changed',
  'presence_evidence',
  'already_decided',
  'caught_up',
  'preview_required',
])

/** A `RAISE EXCEPTION 'rota:<code>'` from one of the 063 RPCs. */
export class RotaRpcError extends DbError {
  readonly rotaCode: RotaRpcCode

  constructor(rotaCode: RotaRpcCode, message: string, cause?: unknown) {
    super(message, { code: `ROTA_${rotaCode.toUpperCase()}`, cause })
    this.name = 'RotaRpcError'
    this.rotaCode = rotaCode
  }
}

/**
 * Error codes meaning "the rota schema is not installed":
 * PostgREST PGRST205 (relation not in schema cache), PGRST202 (function not
 * in schema cache); Postgres 42P01 (undefined_table), 42883 (undefined_function).
 */
const NOT_INSTALLED_CODES: ReadonlySet<string> = new Set(['PGRST205', 'PGRST202', '42P01', '42883'])

export function isRotaNotInstalledDriverError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && NOT_INSTALLED_CODES.has(code)
}

/**
 * Map a driver error to the rota error family:
 *   not-installed codes → RotaNotInstalledError
 *   `rota:<code>` RPC messages → RotaRpcError
 *   anything else → toDbError
 * The driver message is kept only as the `cause`; rota RPC messages never
 * carry ids or values (063 contract).
 */
export function toRotaDbError(message: string, error: unknown): DbError {
  if (error instanceof DbError) return error
  if (isRotaNotInstalledDriverError(error)) {
    return new RotaNotInstalledError(`${message}: rota availability is not installed`, error)
  }
  if (error && typeof error === 'object') {
    const raw = (error as { message?: unknown }).message
    if (typeof raw === 'string') {
      const match = /^rota:([a-z_]+)$/.exec(raw.trim())
      if (match && ROTA_RPC_CODES.has(match[1])) {
        return new RotaRpcError(match[1] as RotaRpcCode, `${message}: rota:${match[1]}`, error)
      }
    }
  }
  return toDbError(message, error)
}

// -----------------------------------------------------------------------------
// Row mappers
// -----------------------------------------------------------------------------

interface SettingsDbRow {
  org_id: string
  enabled: boolean
  retention_days: number
  horizon_days: number
  dpia_reference: string | null
  privacy_notice_confirmed_at: string | null
  enabled_at: string | null
}

const SETTINGS_COLUMNS =
  'org_id, enabled, retention_days, horizon_days, dpia_reference, privacy_notice_confirmed_at, enabled_at'

function mapSettings(row: SettingsDbRow): RotaSettingsRow {
  return {
    orgId: row.org_id,
    enabled: row.enabled,
    retentionDays: row.retention_days,
    horizonDays: row.horizon_days,
    dpiaReference: row.dpia_reference,
    privacyNoticeConfirmedAt: row.privacy_notice_confirmed_at,
    enabledAt: row.enabled_at,
  }
}

interface ProfileDbRow {
  id: string
  department_id: string
  name: string
  config: unknown
  updated_at: string
}

const PROFILE_COLUMNS = 'id, department_id, name, config, updated_at'

function mapProfile(row: ProfileDbRow): RotaUploadProfileRow {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    config: row.config,
    updatedAt: row.updated_at,
  }
}

interface FlagDbRow {
  session_id: string
  user_id: string
  kind: RotaBatchKind
  as_of: string
  batch_id: string
  state: RotaFlagRow['state']
  rota_changed_at: string | null
  decided_by: string | null
  decided_at: string | null
  contested_at: string | null
}

const FLAG_COLUMNS =
  'session_id, user_id, kind, as_of, batch_id, state, rota_changed_at, decided_by, decided_at, contested_at'

function mapFlag(row: FlagDbRow): RotaFlagRow {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    kind: row.kind,
    asOf: row.as_of,
    batchId: row.batch_id,
    state: row.state,
    rotaChangedAt: row.rota_changed_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    contestedAt: row.contested_at,
  }
}

function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function toCountRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = toCount(v)
  }
  return out
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function displayNameOf(profile: {
  email: string | null
  full_name: string | null
  first_name: string | null
  last_name: string | null
} | null | undefined): string {
  if (!profile) return ''
  const full = profile.full_name?.trim()
  if (full) return full
  const joined = [profile.first_name, profile.last_name]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
  return joined || profile.email || ''
}

// -----------------------------------------------------------------------------
// Settings / enrolment
// -----------------------------------------------------------------------------

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function getRotaSettings(orgId: string): Promise<RotaSettingsRow | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_settings')
    .select(SETTINGS_COLUMNS)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read rota settings', error)
  return data ? mapSettings(data as SettingsDbRow) : null
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts
 * (org admin). Upserts the governance fields and never flips `enabled`. The
 * DB CHECK refuses clearing governance while the org is enabled.
 */
export async function saveRotaGovernance(input: {
  orgId: string
  actorUserId: string
  dpiaReference: string
  privacyNoticeConfirmed: boolean
  retentionDays: number
  horizonDays: number
}): Promise<RotaSettingsRow> {
  const db = await getServiceDb()
  const { data: existing, error: readError } = await db
    .from('rota_settings')
    .select('privacy_notice_confirmed_at, privacy_notice_confirmed_by')
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (readError) throw toRotaDbError('Failed to read rota settings', readError)

  const prior = existing as { privacy_notice_confirmed_at: string | null; privacy_notice_confirmed_by: string | null } | null
  const nowIso = new Date().toISOString()
  const confirmedAt = input.privacyNoticeConfirmed ? (prior?.privacy_notice_confirmed_at ?? nowIso) : null
  const confirmedBy = input.privacyNoticeConfirmed
    ? (prior?.privacy_notice_confirmed_at ? prior.privacy_notice_confirmed_by : input.actorUserId)
    : null
  const dpia = input.dpiaReference.trim()

  const { data, error } = await db
    .from('rota_settings')
    .upsert(
      {
        org_id: input.orgId,
        dpia_reference: dpia.length > 0 ? dpia : null,
        privacy_notice_confirmed_at: confirmedAt,
        privacy_notice_confirmed_by: confirmedBy,
        retention_days: input.retentionDays,
        horizon_days: input.horizonDays,
        updated_at: nowIso,
      },
      { onConflict: 'org_id' }
    )
    .select(SETTINGS_COLUMNS)
    .single()
  if (error) throw toRotaDbError('Failed to save rota governance', error)
  return mapSettings(data as SettingsDbRow)
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts
 * (org admin). The table CHECK refuses enabling without a DPIA reference and
 * a privacy-notice confirmation (Postgres 23514 surfaces as DbError code).
 */
export async function setRotaEnabled(input: { orgId: string; actorUserId: string }): Promise<RotaSettingsRow> {
  const db = await getServiceDb()
  const nowIso = new Date().toISOString()
  const { data, error } = await db
    .from('rota_settings')
    .update({ enabled: true, enabled_by: input.actorUserId, enabled_at: nowIso, updated_at: nowIso })
    .eq('org_id', input.orgId)
    .select(SETTINGS_COLUMNS)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to enable rota availability', error)
  if (!data) throw new DbNotFoundError('Rota settings not found')
  return mapSettings(data as SettingsDbRow)
}

/**
 * Service-role: RPC disable_rota_for_org_v1 (063); caller authorized via
 * lib/rota/access.ts (org admin). Deletes the org's flags and links, keeps
 * profiles/uploaders/enrolment/audit, sets enabled = false.
 */
export async function disableRotaForOrg(input: { orgId: string; actorUserId: string }): Promise<Record<string, number>> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('disable_rota_for_org_v1', {
    p_org_id: input.orgId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw toRotaDbError('Failed to disable rota availability', error)
  return toCountRecord(data)
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function listRotaDepartmentIds(orgId: string): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_departments')
    .select('department_id')
    .eq('org_id', orgId)
  if (error) throw toRotaDbError('Failed to list rota departments', error)
  return ((data as { department_id: string }[] | null) ?? []).map((row) => row.department_id)
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function isRotaDepartment(orgId: string, departmentId: string): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_departments')
    .select('department_id')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read rota department', error)
  return Boolean(data)
}

/**
 * Service-role: deny-all tables (063); caller authorized via lib/rota/access.ts
 * (org admin, department in the caller's org). Enrolling inserts a default
 * (disabled) rota_settings row first when missing (FK). A cross-org
 * department is refused by the composite FK. Un-enrolling cascades the
 * department's uploader grants and deletes its flags immediately (the read
 * view and the purge would hide/remove them anyway).
 */
export async function setRotaDepartmentEnrolment(input: {
  orgId: string
  departmentId: string
  enrolled: boolean
  actorUserId: string
}): Promise<void> {
  const db = await getServiceDb()
  if (input.enrolled) {
    const { error: settingsError } = await db
      .from('rota_settings')
      .upsert({ org_id: input.orgId }, { onConflict: 'org_id', ignoreDuplicates: true })
    if (settingsError) throw toRotaDbError('Failed to initialise rota settings', settingsError)

    const { error } = await db
      .from('rota_departments')
      .upsert(
        { department_id: input.departmentId, org_id: input.orgId, enrolled_by: input.actorUserId },
        { onConflict: 'department_id', ignoreDuplicates: true }
      )
    if (error) throw toRotaDbError('Failed to enrol rota department', error)
    return
  }

  const { error } = await db
    .from('rota_departments')
    .delete()
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
  if (error) throw toRotaDbError('Failed to un-enrol rota department', error)

  const { error: flagsError } = await db
    .from('rota_session_flags')
    .delete()
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
  if (flagsError) throw toRotaDbError('Failed to delete rota flags for department', flagsError)
}

// -----------------------------------------------------------------------------
// Uploaders
// -----------------------------------------------------------------------------

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function listRotaUploaders(
  orgId: string
): Promise<{ departmentId: string; userId: string; grantedAt: string }[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_uploaders')
    .select('department_id, user_id, granted_at')
    .eq('org_id', orgId)
    .order('granted_at', { ascending: true })
  if (error) throw toRotaDbError('Failed to list rota uploaders', error)
  return ((data as { department_id: string; user_id: string; granted_at: string }[] | null) ?? []).map((row) => ({
    departmentId: row.department_id,
    userId: row.user_id,
    grantedAt: row.granted_at,
  }))
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function isRotaUploader(orgId: string, departmentId: string, userId: string): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_uploaders')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('department_id', departmentId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read rota uploader grant', error)
  return Boolean(data)
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function listUploaderDepartmentIds(orgId: string, userId: string): Promise<string[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_uploaders')
    .select('department_id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
  if (error) throw toRotaDbError('Failed to list rota uploader departments', error)
  return ((data as { department_id: string }[] | null) ?? []).map((row) => row.department_id)
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts
 * (org admin). The FK requires the department to be enrolled in the same org.
 * Idempotent.
 */
export async function grantRotaUploader(input: {
  orgId: string
  departmentId: string
  userId: string
  grantedBy: string
}): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('rota_uploaders')
    .upsert(
      {
        department_id: input.departmentId,
        org_id: input.orgId,
        user_id: input.userId,
        granted_by: input.grantedBy,
      },
      { onConflict: 'department_id,user_id', ignoreDuplicates: true }
    )
  if (error) throw toRotaDbError('Failed to grant rota uploader', error)
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function revokeRotaUploader(input: { orgId: string; departmentId: string; userId: string }): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('rota_uploaders')
    .delete()
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .eq('user_id', input.userId)
  if (error) throw toRotaDbError('Failed to revoke rota uploader', error)
}

// -----------------------------------------------------------------------------
// Upload profiles (header names + code legend; no person data)
// -----------------------------------------------------------------------------

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function listUploadProfiles(orgId: string, departmentId: string): Promise<RotaUploadProfileRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_upload_profiles')
    .select(PROFILE_COLUMNS)
    .eq('org_id', orgId)
    .eq('department_id', departmentId)
    .order('name', { ascending: true })
  if (error) throw toRotaDbError('Failed to list rota upload profiles', error)
  return ((data as ProfileDbRow[] | null) ?? []).map(mapProfile)
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts.
 * The config must already be zod-validated (`rotaProfileConfigSchema`).
 * A duplicate name in the department surfaces as DbConflictError (23505).
 */
export async function saveUploadProfile(input: {
  orgId: string
  departmentId: string
  id?: string
  name: string
  config: RotaProfileConfig
  actorUserId: string
}): Promise<RotaUploadProfileRow> {
  const db = await getServiceDb()
  const nowIso = new Date().toISOString()
  const values = {
    name: input.name.trim(),
    config: input.config,
    updated_by: input.actorUserId,
    updated_at: nowIso,
  }

  if (input.id) {
    const { data, error } = await db
      .from('rota_upload_profiles')
      .update(values)
      .eq('id', input.id)
      .eq('org_id', input.orgId)
      .eq('department_id', input.departmentId)
      .select(PROFILE_COLUMNS)
      .maybeSingle()
    if (error) throw toRotaDbError('Failed to update rota upload profile', error)
    if (!data) throw new DbNotFoundError('Rota upload profile not found')
    return mapProfile(data as ProfileDbRow)
  }

  const { data, error } = await db
    .from('rota_upload_profiles')
    .insert({ ...values, org_id: input.orgId, department_id: input.departmentId })
    .select(PROFILE_COLUMNS)
    .single()
  if (error) throw toRotaDbError('Failed to create rota upload profile', error)
  return mapProfile(data as ProfileDbRow)
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function deleteUploadProfile(input: { orgId: string; departmentId: string; id: string }): Promise<void> {
  const db = await getServiceDb()
  const { error } = await db
    .from('rota_upload_profiles')
    .delete()
    .eq('id', input.id)
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
  if (error) throw toRotaDbError('Failed to delete rota upload profile', error)
}

// -----------------------------------------------------------------------------
// Identity links + membership-oracle audit
// -----------------------------------------------------------------------------

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts.
 * Resolves keyed HMACs (never the identifier) to linked users, in chunks of
 * 100 so the `in.(...)` URL stays bounded.
 */
export async function findLinksByHmac(
  orgId: string,
  keys: { keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string }[]
): Promise<{ keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string; userId: string }[]> {
  if (keys.length === 0) return []
  const db = await getServiceDb()
  const out: { keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string; userId: string }[] = []
  for (const keyType of ['STAFF_ID', 'EMAIL'] as const) {
    const hmacs = [...new Set(keys.filter((key) => key.keyType === keyType).map((key) => key.keyHmac))]
    for (const part of chunk(hmacs, 100)) {
      const { data, error } = await db
        .from('rota_identity_links')
        .select('key_type, key_hmac, user_id')
        .eq('org_id', orgId)
        .eq('key_type', keyType)
        .in('key_hmac', part)
      if (error) throw toRotaDbError('Failed to look up rota identity links', error)
      for (const row of (data as { key_type: 'STAFF_ID' | 'EMAIL'; key_hmac: string; user_id: string }[] | null) ?? []) {
        out.push({ keyType: row.key_type, keyHmac: row.key_hmac, userId: row.user_id })
      }
    }
  }
  return out
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. Never returns key_hmac. */
export async function listLinksForUsers(orgId: string, userIds: string[]): Promise<RotaLinkRow[]> {
  const unique = [...new Set(userIds)]
  if (unique.length === 0) return []
  const db = await getServiceDb()
  const out: RotaLinkRow[] = []
  for (const part of chunk(unique, 100)) {
    const { data, error } = await db
      .from('rota_identity_links')
      .select('id, user_id, key_type, origin, confirmed_at')
      .eq('org_id', orgId)
      .in('user_id', part)
      .order('confirmed_at', { ascending: false })
    if (error) throw toRotaDbError('Failed to list rota identity links', error)
    for (const row of (data as {
      id: string
      user_id: string
      key_type: RotaLinkRow['keyType']
      origin: RotaLinkRow['origin']
      confirmed_at: string
    }[] | null) ?? []) {
      out.push({ id: row.id, userId: row.user_id, keyType: row.key_type, origin: row.origin, confirmedAt: row.confirmed_at })
    }
  }
  return out
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts
 * (rota moderator; the action checks the link's user is a current trainee of
 * the department first, via listLinksForUsers).
 */
export async function revokeLink(input: { orgId: string; linkId: string }): Promise<{ userId: string } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_identity_links')
    .delete()
    .eq('org_id', input.orgId)
    .eq('id', input.linkId)
    .select('user_id')
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to revoke rota identity link', error)
  return data ? { userId: (data as { user_id: string }).user_id } : null
}

/**
 * Service-role: RPC record_rota_match_preview_v1 (063); caller authorized via
 * lib/rota/access.ts. One preview per (org, upload id), and an uploader at
 * most `maxPerDay` in 24 hours, checked and recorded atomically under a
 * per-caller lock (parallel previews cannot exceed the limit). Counts only.
 */
export async function recordMatchPreview(input: {
  orgId: string
  departmentId: string
  uploadId: string
  callerUserId: string
  callerRole: 'MODERATOR' | 'UPLOADER'
  peopleCount: number
  maxPerDay: number
}): Promise<'recorded' | 'duplicate' | 'rate_limited'> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('record_rota_match_preview_v1', {
    p_org_id: input.orgId,
    p_department_id: input.departmentId,
    p_upload_id: input.uploadId,
    p_caller_user_id: input.callerUserId,
    p_caller_role: input.callerRole,
    p_people_count: input.peopleCount,
    p_max_per_day: input.maxPerDay,
  })
  if (error) throw toRotaDbError('Failed to record rota match preview', error)
  if (data === 'recorded' || data === 'duplicate' || data === 'rate_limited') return data
  throw new DbError('Unexpected rota match preview result', { code: 'ROTA_PREVIEW_RESULT' })
}

/**
 * Service-role: deny-all table (063); caller authorized via lib/rota/access.ts.
 * Whether this caller ran the match preview of this upload for this
 * department (the ingest RPC re-checks it).
 */
export async function hasMatchPreview(input: {
  orgId: string
  departmentId: string
  uploadId: string
  callerUserId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_match_previews')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .eq('upload_id', input.uploadId)
    .eq('caller_user_id', input.callerUserId)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read rota match preview', error)
  return Boolean(data)
}

/**
 * Service-role: RPC link_rota_identity_v1 (063), under the per-org lock;
 * caller authorized via lib/rota/access.ts (rota moderator). Stores
 * moderator links for one current trainee from keyed HMACs only (same
 * anti-hijack rule as the ingest).
 */
export async function linkRotaIdentity(input: {
  orgId: string
  departmentId: string
  actorUserId: string
  userId: string
  links: { keyType: 'STAFF_ID' | 'EMAIL'; keyHmac: string }[]
}): Promise<{ linked: number; refused: number }> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('link_rota_identity_v1', {
    p_org_id: input.orgId,
    p_department_id: input.departmentId,
    p_actor_user_id: input.actorUserId,
    p_user_id: input.userId,
    p_links: input.links.map((l) => ({ key_type: l.keyType, key_hmac: l.keyHmac })),
  })
  if (error) throw toRotaDbError('Failed to link rota identity', error)
  const counts = toCountRecord(data)
  return { linked: counts.linked ?? 0, refused: counts.refused ?? 0 }
}

// -----------------------------------------------------------------------------
// Ingest context
// -----------------------------------------------------------------------------

/**
 * Service-role: department_members/profiles have no cross-user SELECT
 * visibility (062); caller authorized via lib/rota/access.ts. Current
 * trainees of the department, paged like listDepartmentMembersWithProfiles.
 */
export async function listDepartmentTrainees(
  orgId: string,
  departmentId: string
): Promise<{ userId: string; email: string; displayName: string }[]> {
  const db = await getServiceDb()
  const pageSize = 1000
  const userIds: string[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('department_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('department_id', departmentId)
      .eq('role', 'trainee')
      .order('created_at', { ascending: true })
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw toDbError('Failed to list department trainees', error)
    const page = (data as { user_id: string }[] | null) ?? []
    userIds.push(...page.map((row) => row.user_id))
    if (page.length < pageSize) break
  }
  if (userIds.length === 0) return []

  type ProfileRow = {
    user_id: string
    email: string | null
    full_name: string | null
    first_name: string | null
    last_name: string | null
  }
  const profiles = new Map<string, ProfileRow>()
  for (const part of chunk(userIds, 100)) {
    const { data, error } = await db
      .from('profiles')
      .select('user_id, email, full_name, first_name, last_name')
      .in('user_id', part)
    if (error) throw toDbError('Failed to read trainee profiles', error)
    for (const profile of (data as ProfileRow[] | null) ?? []) profiles.set(profile.user_id, profile)
  }

  return userIds.map((userId) => {
    const profile = profiles.get(userId)
    return { userId, email: profile?.email ?? '', displayName: displayNameOf(profile) }
  })
}

/**
 * Service-role: sessions read scoped to the caller's org + enrolled
 * department; caller authorized via lib/rota/access.ts. PUBLISHED policy-v2
 * sessions that are not FINALIZED, end no earlier than now − 14 days and
 * overlap [fromIso, toIso). Drafts get no flags (confirm refuses them).
 */
export async function listRotaCandidateSessions(input: {
  orgId: string
  departmentId: string
  fromIso: string
  toIso: string
}): Promise<RotaCandidateSession[]> {
  const db = await getServiceDb()
  const floorMs = Date.now() - 14 * 24 * 60 * 60 * 1000
  const fromMs = Date.parse(input.fromIso)
  const endFloorIso = new Date(Number.isFinite(fromMs) ? Math.max(fromMs, floorMs) : floorMs).toISOString()
  const pageSize = 1000
  const out: RotaCandidateSession[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('sessions')
      .select('id, date_start, date_end')
      .eq('org_id', input.orgId)
      .eq('department_id', input.departmentId)
      .eq('attendance_policy_version', 2)
      .eq('status', 'PUBLISHED')
      .neq('attendance_phase', 'FINALIZED')
      .gt('date_end', endFloorIso)
      .lt('date_start', input.toIso)
      .order('date_start', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw toDbError('Failed to list rota candidate sessions', error)
    const page = (data as RotaCandidateSession[] | null) ?? []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

interface IngestRpcResult {
  batch_id?: unknown
  replayed?: unknown
  flags_inserted?: unknown
  flags_replaced?: unknown
  flags_deleted?: unknown
  decided_marked_changed?: unknown
  decided_unmarked?: unknown
  links_upserted?: unknown
  links_refused?: unknown
  rows_rejected?: unknown
  sessions_annotated?: unknown
}

/**
 * Service-role: RPC ingest_rota_batch_v1 (063), one transaction under a
 * per-org advisory lock; caller authorized via lib/rota/access.ts. Receives
 * HMACs and user ids only, never identifiers in clear.
 */
export async function ingestBatch(input: {
  orgId: string
  departmentId: string
  actorUserId: string
  batch: RotaBatchRecordInput
  flags: RotaFlagKey[]
  cleared: RotaFlagKey[]
  links: RotaNewLink[]
}): Promise<RotaIngestResult> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('ingest_rota_batch_v1', {
    p_org_id: input.orgId,
    p_department_id: input.departmentId,
    p_actor_user_id: input.actorUserId,
    p_batch: input.batch,
    p_flags: input.flags.map((f) => ({ session_id: f.session_id, user_id: f.user_id })),
    p_cleared: input.cleared.map((f) => ({ session_id: f.session_id, user_id: f.user_id })),
    p_links: input.links.map((l) => ({
      key_type: l.key_type,
      key_hmac: l.key_hmac,
      user_id: l.user_id,
      origin: l.origin,
    })),
  })
  if (error) throw toRotaDbError('Failed to ingest rota batch', error)
  const row = (data ?? {}) as IngestRpcResult
  return {
    batchId: typeof row.batch_id === 'string' ? row.batch_id : input.batch.id,
    replayed: row.replayed === true,
    flagsInserted: toCount(row.flags_inserted),
    flagsReplaced: toCount(row.flags_replaced),
    flagsDeleted: toCount(row.flags_deleted),
    decidedMarkedChanged: toCount(row.decided_marked_changed),
    decidedUnmarked: toCount(row.decided_unmarked),
    linksUpserted: toCount(row.links_upserted),
    linksRefused: toCount(row.links_refused),
    rowsRejected: toCount(row.rows_rejected),
    sessionsAnnotated: toCount(row.sessions_annotated),
  }
}

/** Service-role: deny-all table (063); caller authorized via lib/rota/access.ts. */
export async function findLatestBatch(input: {
  orgId: string
  departmentId: string
  kind: 'PLANNED' | 'WORKED'
}): Promise<{ createdAt: string; rangeTo: string; peopleUnmatched: number } | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_import_batches')
    .select('created_at, range_to, people_unmatched')
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .eq('kind', input.kind)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read latest rota batch', error)
  if (!data) return null
  const row = data as { created_at: string; range_to: string; people_unmatched: number | null }
  return { createdAt: row.created_at, rangeTo: row.range_to, peopleUnmatched: row.people_unmatched ?? 0 }
}

// -----------------------------------------------------------------------------
// Flags (reads go through the security-invoker view rota_visible_session_flags)
// -----------------------------------------------------------------------------

/**
 * Service-role: deny-all view (063, D5 read rule); caller authorized via
 * lib/rota/access.ts (rota moderator of the session's department).
 */
export async function listFlagsForSession(input: { orgId: string; sessionId: string }): Promise<RotaFlagRow[]> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_visible_session_flags')
    .select(FLAG_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
  if (error) throw toRotaDbError('Failed to list rota flags', error)
  return ((data as FlagDbRow[] | null) ?? []).map(mapFlag)
}

/** Service-role: deny-all view (063, D5); the caller's own user id only. */
export async function findOwnFlag(input: {
  orgId: string
  sessionId: string
  userId: string
}): Promise<RotaFlagRow | null> {
  const db = await getServiceDb()
  const { data, error } = await db
    .from('rota_visible_session_flags')
    .select(FLAG_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (error) throw toRotaDbError('Failed to read own rota flag', error)
  return data ? mapFlag(data as FlagDbRow) : null
}

/**
 * Service-role: RPC confirm_rota_excusal_v1 (063), transactional; caller
 * authorized via lib/rota/access.ts (rota moderator). Writes one
 * MODERATOR_CONFIRMATION EXCUSED evidence row with the batch id in metadata.
 */
export async function confirmRotaExcusal(input: {
  orgId: string
  sessionId: string
  userId: string
  actorUserId: string
}): Promise<Attendance> {
  const db = await getServiceDb()
  const { data, error } = await db
    .rpc('confirm_rota_excusal_v1', {
      p_org_id: input.orgId,
      p_session_id: input.sessionId,
      p_user_id: input.userId,
      p_actor_user_id: input.actorUserId,
    })
    .single()
  if (error) throw toRotaDbError('Failed to confirm rota excusal', error)
  return data as Attendance
}

/**
 * Service-role: RPC dismiss_rota_suggestion_v1 (063); caller authorized via
 * lib/rota/access.ts (rota moderator; session timing checked by the action).
 * Conditional OPEN → DISMISSED transition plus a lasting
 * ROTA_SUGGESTION_DISMISSED session activity event, in one transaction;
 * false when nothing changed.
 */
export async function dismissRotaSuggestion(input: {
  orgId: string
  sessionId: string
  userId: string
  actorUserId: string
}): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('dismiss_rota_suggestion_v1', {
    p_org_id: input.orgId,
    p_session_id: input.sessionId,
    p_user_id: input.userId,
    p_actor_user_id: input.actorUserId,
  })
  if (error) throw toRotaDbError('Failed to dismiss rota suggestion', error)
  return data === true
}

/**
 * Service-role: RPC contest_rota_flag_v1 (063); the caller's own user id only
 * (the action passes the authenticated user, never a body value). Conditional
 * OPEN → CONTESTED transition plus a lasting ROTA_FLAG_CONTESTED session
 * activity event, in one transaction; false when nothing changed.
 */
export async function contestOwnFlag(input: { orgId: string; sessionId: string; userId: string }): Promise<boolean> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('contest_rota_flag_v1', {
    p_org_id: input.orgId,
    p_session_id: input.sessionId,
    p_user_id: input.userId,
  })
  if (error) throw toRotaDbError('Failed to contest rota flag', error)
  return data === true
}

/**
 * Service-role: deny-all table (063); called by the session-edit hook after
 * an authorized update (time change or cancel). Returns rows deleted.
 */
export async function deleteFlagsForSession(input: { orgId: string; sessionId: string }): Promise<number> {
  const db = await getServiceDb()
  const { count, error } = await db
    .from('rota_session_flags')
    .delete({ count: 'exact' })
    .eq('org_id', input.orgId)
    .eq('session_id', input.sessionId)
  if (error) throw toRotaDbError('Failed to delete rota flags for session', error)
  return count ?? 0
}

/**
 * Service-role: deny-all table (063); called by the member-removal hook after
 * an authorized removal. Deletes the user's flags for the department, then
 * runs the org-scoped purge (deletion only) so a leaver's identity link goes
 * too once they are no longer a trainee in any enrolled department. Returns
 * the flags deleted for this department.
 */
export async function deleteFlagsForMember(input: {
  orgId: string
  departmentId: string
  userId: string
}): Promise<number> {
  const db = await getServiceDb()
  const { count, error } = await db
    .from('rota_session_flags')
    .delete({ count: 'exact' })
    .eq('org_id', input.orgId)
    .eq('department_id', input.departmentId)
    .eq('user_id', input.userId)
  if (error) throw toRotaDbError('Failed to delete rota flags for member', error)

  const { error: purgeError } = await db.rpc('purge_rota_data_v1', { p_org_id: input.orgId })
  if (purgeError) throw toRotaDbError('Failed to purge rota data for org', purgeError)
  return count ?? 0
}

/**
 * Service-role: RPC purge_rota_data_v1 (063), deletion only. Runs from the
 * post-session-reports cron even with the kill switch off (plan D9); returns
 * 'not_installed' (silently) before 063 is applied. No orgId = every org.
 */
export async function purgeRotaData(orgId?: string): Promise<Record<string, number> | 'not_installed'> {
  const db = await getServiceDb()
  const { data, error } = await db.rpc('purge_rota_data_v1', { p_org_id: orgId ?? null })
  if (error) {
    if (isRotaNotInstalledDriverError(error)) return 'not_installed'
    throw toRotaDbError('Failed to purge rota data', error)
  }
  return toCountRecord(data)
}
