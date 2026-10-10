/**
 * Rota availability (spec/14): shared types for the browser upload, the
 * server actions, the DAL and the attendance panel. Everything rota-related
 * is typed here; nothing is added to lib/types.ts.
 *
 * Letters (O3: no category is ever stored or shown):
 *   A available · D on duty elsewhere · N night or post-night rest
 *   X not working · L leave (every kind of leave collapses to L in the browser)
 */

export type RotaLetter = 'A' | 'D' | 'N' | 'X' | 'L'
export type RotaSegment = [start: string /*HH:MM*/, end: string /*HH:MM|24:00*/, letter: RotaLetter]
export type RotaBatchKind = 'PLANNED' | 'WORKED'
export type RotaResult<T = void> = { ok: true; data: T } | { ok: false; message: string; code?: string }

export interface RotaPersonLink {
  user_id: string
  origin: 'MODERATOR' | 'EMAIL_MATCH'
}
export interface RotaBatchPerson {
  ref: string
  staff_key?: string
  email?: string
  link?: RotaPersonLink
  days: string
}
export interface RotaBatchPayload {
  v: 1
  batch_id: string
  kind: RotaBatchKind
  range: { from: string; to: string } // local YYYY-MM-DD, APP_TIME_ZONE
  templates: Record<string, RotaSegment[]>
  people: RotaBatchPerson[]
}
export type RotaAvailability =
  | { available: true; orgId: string; departmentId: string | null; retentionDays: number; horizonDays: number }
  | {
      available: false
      reason: 'kill_switch' | 'secret_missing' | 'not_installed' | 'org_disabled' | 'department_not_enrolled'
    }

export interface RotaCandidateSession {
  id: string
  date_start: string
  date_end: string
}
export interface RotaFlagKey {
  session_id: string
  user_id: string
}
export interface RotaNewLink {
  key_type: 'STAFF_ID' | 'EMAIL'
  key_hmac: string
  user_id: string
  origin: 'MODERATOR' | 'EMAIL_MATCH'
}
export interface RotaBatchRecordInput {
  id: string
  /** The upload (one match preview) this batch belongs to. */
  upload_id: string
  kind: RotaBatchKind
  /** Keyed digest: rotaBatchDigest(secret, orgId, sha256(canonical batch)). */
  payload_digest: string
  range_from: string
  range_to: string
  profile_id: string | null
  people_received: number
  people_matched: number
  people_unmatched: number
  conflicts: number
}
export interface RotaIngestResult {
  batchId: string
  replayed: boolean
  flagsInserted: number
  flagsReplaced: number
  flagsDeleted: number
  decidedMarkedChanged: number
  decidedUnmarked: number
  linksUpserted: number
  linksRefused: number
  rowsRejected: number
  sessionsAnnotated: number
}
/**
 * What one batch's upload returns. Coordinators (uploaders) get only these
 * counts: nothing that could reveal another person's flag or a moderator's or
 * trainee's decision (spec/14).
 */
export interface RotaUploadSummary {
  replayed: boolean
  peopleReceived: number
  matched: number
  unmatched: number
  conflicts: number
  sessionsAnnotated: number
  newUnmatchedSinceLast: number | null
  /** Moderators only; null for an uploader. */
  details: Omit<RotaIngestResult, 'replayed' | 'sessionsAnnotated'> | null
}
export interface RotaFlagRow {
  sessionId: string
  userId: string
  kind: RotaBatchKind
  asOf: string
  batchId: string
  state: 'OPEN' | 'CONFIRMED' | 'DISMISSED' | 'CONTESTED'
  rotaChangedAt: string | null
  decidedBy: string | null
  decidedAt: string | null
  contestedAt: string | null
}
export type RotaSuggestionState = 'SUGGESTED' | 'CONFIRMED' | 'DISMISSED' | 'CONTESTED' | 'DECIDED_MANUALLY' | 'NONE'
export interface RotaSuggestionRow {
  userId: string
  displayName: string
  state: RotaSuggestionState
  asOf: string | null
  kind: RotaBatchKind | null
  markers: { contested: boolean; rotaChanged: boolean; evidenceAfterExcusal: boolean }
  canConfirm: boolean
  canDismiss: boolean
}
export interface RotaSuggestionsView {
  sessionId: string
  departmentId: string
  readOnlyUntilEnd: boolean
  /** No as-worked upload covers the session's day yet: suggestions come from the planned rota. */
  showAsWorkedBanner: boolean
  rows: RotaSuggestionRow[] // asOf pre-formatted server-side via formatAppDateTime
}
export interface OwnRotaFlagView {
  sessionId: string
  state: RotaFlagRow['state']
  asOfLabel: string
  kind: RotaBatchKind
  canContest: boolean
  /** The session has not started yet (the note then asks the trainee to attend if they can). */
  beforeSession: boolean
}
export interface RotaSettingsRow {
  orgId: string
  enabled: boolean
  retentionDays: number
  horizonDays: number
  dpiaReference: string | null
  privacyNoticeConfirmedAt: string | null
  enabledAt: string | null
}
export interface RotaUploadProfileRow {
  id: string
  departmentId: string
  name: string
  config: unknown
  updatedAt: string
}
export interface RotaLinkRow {
  id: string
  userId: string
  keyType: 'STAFF_ID' | 'EMAIL'
  origin: 'MODERATOR' | 'EMAIL_MATCH'
  confirmedAt: string
}
export interface RotaLinkedStaffRow extends RotaLinkRow {
  displayName: string
}
export interface RotaAdminState {
  /**
   * The kill switch is off (or the identity secret is missing) but rota data
   * is still stored: only the deletion actions (disable, remove a department,
   * remove an uploader) are offered.
   */
  cleanupOnly: boolean
  settings: RotaSettingsRow | null
  departments: { id: string; name: string; enrolled: boolean }[]
  uploaders: { departmentId: string; userId: string; displayName: string; grantedAt: string }[]
}
export type RotaMatchPreview =
  | {
      role: 'MODERATOR'
      rows: { ref: string; userId: string | null; displayName: string | null; via: 'LINK' | 'EMAIL' | null }[]
    }
  | {
      role: 'UPLOADER'
      /** `proof` (matched rows only) must accompany the row on upload: rows never previewed are refused. */
      rows: { ref: string; matched: boolean; proof: string | null }[]
    }
export interface RotaUploadContext {
  callerRole: 'MODERATOR' | 'UPLOADER'
  todayKey: string
  horizonDays: number
  profiles: RotaUploadProfileRow[]
  roster: { userId: string; displayName: string; email: string }[] | null
  latest: { worked: string | null; planned: string | null }
}
