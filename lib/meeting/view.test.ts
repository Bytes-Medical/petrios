import { describe, expect, it } from 'vitest'
import type { MeetingConfig } from './types'
import { buildMeetingRoomView } from './view'

const SESSION = {
  id: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  title: 'Acute kidney injury',
  status: 'PUBLISHED',
  location_type: 'JITSI',
  date_start: '2026-10-09T12:00:00.000Z',
  date_end: '2026-10-09T13:00:00.000Z',
}
const NOW = new Date('2026-10-09T09:00:00.000Z')

const PUBLIC: MeetingConfig = { ok: true, mode: 'public', domain: 'meet.jit.si', origin: 'https://meet.jit.si', tokenAuth: 'none' }
const JAAS: MeetingConfig = {
  ok: true, mode: 'jaas', domain: '8x8.vc', origin: 'https://8x8.vc', appId: 'vpaas-magic-cookie-abc', tokenAuth: 'jaas-rs256',
}
const SELF_HOSTED: MeetingConfig = {
  ok: true, mode: 'self-hosted', domain: 'meet.example.org', origin: 'https://meet.example.org', tokenAuth: 'none',
}
const UNAVAILABLE: MeetingConfig = {
  ok: false, mode: 'unavailable', error: 'JaaS is partly configured: set all of … (missing: JAAS_PRIVATE_KEY).',
}

function view(config: MeetingConfig, session = SESSION) {
  return buildMeetingRoomView({ session, displayName: 'Grace Hopper', now: NOW, config })
}

describe('buildMeetingRoomView', () => {
  it('carries the server-computed room window and clock as ISO strings', () => {
    expect(view(JAAS)).toMatchObject({
      sessionId: SESSION.id,
      sessionTitle: 'Acute kidney injury',
      opensAt: '2026-10-09T11:30:00.000Z',
      closesAt: '2026-10-09T13:30:00.000Z',
      serverNow: NOW.toISOString(),
      displayName: 'Grace Hopper',
    })
  })

  it('embeds in JaaS and self-hosted modes, without a public room URL', () => {
    for (const config of [JAAS, SELF_HOSTED]) {
      const result = view(config)
      expect(result.embedded).toBe(true)
      expect(result.availability).toBe('ready')
      expect(result.publicRoomUrl).toBeNull()
      expect(result.unavailableMessage).toBeNull()
    }
    expect(view(JAAS).mode).toBe('jaas')
    expect(view(SELF_HOSTED).mode).toBe('self-hosted')
  })

  it('links out in public mode with the meet.jit.si room URL', () => {
    const result = view(PUBLIC)
    expect(result).toMatchObject({ mode: 'public', embedded: false, availability: 'ready' })
    expect(result.publicRoomUrl).toBe(`https://meet.jit.si/Petrios-${SESSION.id}`)
  })

  it('reports a configuration error as unavailable with generic text only', () => {
    const result = view(UNAVAILABLE)
    expect(result).toMatchObject({ mode: 'unavailable', embedded: false, availability: 'unavailable', publicRoomUrl: null })
    expect(result.unavailableMessage).toBe('Video rooms are unavailable right now. Please contact your organiser.')
    expect(JSON.stringify(result)).not.toContain('JAAS')
  })

  it('flags the "Attendee" fallback name and carries the server-computed host flag', () => {
    expect(view(JAAS)).toMatchObject({ displayNameIsFallback: false, viewerIsModerator: false })
    const nameless = buildMeetingRoomView({ session: SESSION, displayName: 'Attendee', now: NOW, config: JAAS })
    expect(nameless.displayNameIsFallback).toBe(true)
    const host = buildMeetingRoomView({ session: SESSION, displayName: 'Grace Hopper', viewerIsModerator: true, now: NOW, config: PUBLIC })
    expect(host.viewerIsModerator).toBe(true)
  })

  it('maps session status to availability, configuration errors first', () => {
    expect(view(JAAS, { ...SESSION, status: 'DRAFT' }).availability).toBe('not_published')
    expect(view(JAAS, { ...SESSION, status: 'CANCELLED' }).availability).toBe('cancelled')
    expect(view(PUBLIC, { ...SESSION, status: 'CANCELLED' }).availability).toBe('cancelled')
    expect(view(UNAVAILABLE, { ...SESSION, status: 'DRAFT' }).availability).toBe('unavailable')
  })
})
