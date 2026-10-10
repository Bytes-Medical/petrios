import { describe, expect, it } from 'vitest'
import { EDITABLE_SESSION_FIELDS, pickEditableSessionUpdates } from './session-updates'

describe('pickEditableSessionUpdates', () => {
  it('passes the edit form fields through unchanged', () => {
    const updates = {
      title: 'Hyperkalaemia',
      description: null,
      date_start: '2026-10-12T09:00:00.000Z',
      date_end: '2026-10-12T10:00:00.000Z',
      location_type: 'MS_TEAMS',
      teams_meeting_url: 'https://teams.microsoft.com/l/meetup-join/abc',
    }
    expect(pickEditableSessionUpdates(updates)).toEqual(updates)
  })

  it('accepts status and meeting URL only updates', () => {
    expect(pickEditableSessionUpdates({ status: 'PUBLISHED' })).toEqual({ status: 'PUBLISHED' })
    expect(pickEditableSessionUpdates({ teams_meeting_url: null })).toEqual({ teams_meeting_url: null })
  })

  it('ignores undefined values', () => {
    expect(pickEditableSessionUpdates({ title: 'A', description: undefined })).toEqual({ title: 'A' })
  })

  it.each([
    'department_id',
    'org_id',
    'created_by',
    'id',
    'attendance_locked',
    'attendance_policy_version',
    'attendance_phase',
    'group_code_enabled',
    'group_code_version',
    'strict_token_hash',
    'reminder_sent_at',
  ])('rejects %s', (key) => {
    expect(() => pickEditableSessionUpdates({ title: 'A', [key]: 'x' })).toThrow(
      `Session field cannot be edited here: ${key}`
    )
  })

  it('rejects re-homing a session into another department with a publish', () => {
    expect(() =>
      pickEditableSessionUpdates({ department_id: 'victim-dept', status: 'PUBLISHED' })
    ).toThrow(/department_id/)
  })

  it('validates value shapes', () => {
    expect(() => pickEditableSessionUpdates({ status: 'ARCHIVED' })).toThrow('Invalid session status')
    expect(() => pickEditableSessionUpdates({ location_type: 'ZOOM' })).toThrow('Invalid location type')
    expect(() => pickEditableSessionUpdates({ title: '   ' })).toThrow('Session title is required')
    expect(() => pickEditableSessionUpdates({ date_start: 'not a date' })).toThrow('Invalid date_start')
    expect(() => pickEditableSessionUpdates({ capacity: -1 })).toThrow('Invalid capacity')
    expect(() => pickEditableSessionUpdates({ tags: ['ok', 3] })).toThrow('Invalid tags')
    expect(() => pickEditableSessionUpdates({ session_type: 'OTHER' })).toThrow('Invalid session type')
    expect(() => pickEditableSessionUpdates(null)).toThrow('Session updates must be an object')
    expect(() => pickEditableSessionUpdates([])).toThrow('Session updates must be an object')
  })

  it('keeps ownership and attendance fields off the allow-list', () => {
    for (const forbidden of ['department_id', 'org_id', 'created_by']) {
      expect(EDITABLE_SESSION_FIELDS as readonly string[]).not.toContain(forbidden)
    }
    expect(EDITABLE_SESSION_FIELDS.some((field) => field.startsWith('attendance_'))).toBe(false)
    expect(EDITABLE_SESSION_FIELDS.some((field) => field.startsWith('group_code'))).toBe(false)
  })
})
