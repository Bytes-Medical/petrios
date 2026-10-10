import type { LocationType, Session, SessionStatus, SessionType } from '@/lib/types'

/**
 * Allow-list for the interactive session edit action (`updateSession`). The
 * action receives an arbitrary object from the client, so only descriptive
 * fields may change. Ownership (`org_id`, `department_id`, `created_by`) and
 * every attendance / group-code / reminder field are governed by their own
 * subsystems (spec/03) and are rejected rather than silently dropped, so a
 * caller learns the write did not happen.
 */
export const EDITABLE_SESSION_FIELDS = [
  'title',
  'description',
  'date_start',
  'date_end',
  'location_type',
  'teams_meeting_url',
  'status',
  'session_type',
  'tags',
  'capacity',
] as const

export type EditableSessionField = (typeof EDITABLE_SESSION_FIELDS)[number]
export type EditableSessionUpdates = Partial<Pick<Session, EditableSessionField>>

const SESSION_STATUSES: readonly SessionStatus[] = ['DRAFT', 'PUBLISHED', 'CANCELLED']
const LOCATION_TYPES: readonly LocationType[] = ['MS_TEAMS', 'IN_PERSON', 'HYBRID', 'JITSI']
const SESSION_TYPES: readonly SessionType[] = ['STEPP', 'CLINICAL_SKILLS', 'SIMULATION', 'ACADEMIC']

function isEditableField(key: string): key is EditableSessionField {
  return (EDITABLE_SESSION_FIELDS as readonly string[]).includes(key)
}

function fail(message: string): never {
  throw new Error(message)
}

/**
 * Returns a copy holding only allow-listed fields with valid values. Throws
 * on any other key (including `department_id`, `org_id`, `created_by`,
 * `attendance_*` and `group_code_*`) or on a malformed value. Keys whose value
 * is `undefined` are ignored, matching how a partial update is built.
 */
export function pickEditableSessionUpdates(updates: unknown): EditableSessionUpdates {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    fail('Session updates must be an object')
  }

  const picked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
    if (value === undefined) continue
    if (!isEditableField(key)) fail(`Session field cannot be edited here: ${key}`)

    switch (key) {
      case 'title':
        if (typeof value !== 'string' || !value.trim()) fail('Session title is required')
        break
      case 'description':
      case 'teams_meeting_url':
        if (value !== null && typeof value !== 'string') fail(`Invalid ${key}`)
        break
      case 'date_start':
      case 'date_end':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          fail(`Invalid ${key}`)
        }
        break
      case 'status':
        if (!SESSION_STATUSES.includes(value as SessionStatus)) fail('Invalid session status')
        break
      case 'location_type':
        if (!LOCATION_TYPES.includes(value as LocationType)) fail('Invalid location type')
        break
      case 'session_type':
        if (value !== null && !SESSION_TYPES.includes(value as SessionType)) {
          fail('Invalid session type')
        }
        break
      case 'tags':
        if (
          value !== null &&
          (!Array.isArray(value) || !value.every((tag) => typeof tag === 'string'))
        ) {
          fail('Invalid tags')
        }
        break
      case 'capacity':
        if (value !== null && (!Number.isInteger(value) || (value as number) < 0)) {
          fail('Invalid capacity')
        }
        break
    }
    picked[key] = value
  }
  return picked as EditableSessionUpdates
}
