import { describe, expect, it } from 'vitest'
import { meetingStatusSummary } from './status'
import type { MeetingConfig } from './types'

const JAAS: MeetingConfig = {
  ok: true, mode: 'jaas', domain: '8x8.vc', origin: 'https://8x8.vc', appId: 'vpaas-magic-cookie-abc', tokenAuth: 'jaas-rs256',
}

describe('meetingStatusSummary', () => {
  it('names public mode and how to enable embedded rooms', () => {
    const summary = meetingStatusSummary(
      { ok: true, mode: 'public', domain: 'meet.jit.si', origin: 'https://meet.jit.si', tokenAuth: 'none' },
      { externalTeacherPasses: false }
    )
    expect(summary).toMatchObject({ ready: true })
    expect(summary.mode).toContain('meet.jit.si')
    expect(summary.detail).toMatch(/JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY/)
  })

  it('shows the configuration error (variable names only) as not ready', () => {
    const summary = meetingStatusSummary(
      { ok: false, mode: 'unavailable', error: 'JaaS is partly configured (missing: JAAS_PRIVATE_KEY).' },
      { externalTeacherPasses: true }
    )
    expect(summary.ready).toBe(false)
    expect(summary.detail).toContain('missing: JAAS_PRIVATE_KEY')
  })

  it('says whether external teachers can get room passes in token modes', () => {
    expect(meetingStatusSummary(JAAS, { externalTeacherPasses: true }).detail).toContain('join from their invitation link')
    expect(meetingStatusSummary(JAAS, { externalTeacherPasses: false }).detail).toContain('TEACHER_INVITATIONS_RLS_LOCKED=true')
  })

  it('warns that self-hosted moderation depends on the Jitsi server, and that open rooms need no pass', () => {
    const hs: MeetingConfig = {
      ok: true, mode: 'self-hosted', domain: 'meet.example.org', origin: 'https://meet.example.org', tokenAuth: 'hs256',
      appId: 'petrios', audience: 'jitsi', subject: 'meet.example.org',
    }
    expect(meetingStatusSummary(hs, { externalTeacherPasses: true }).detail).toMatch(/depend on your Jitsi server settings/)
    const open: MeetingConfig = { ok: true, mode: 'self-hosted', domain: 'meet.example.org', origin: 'https://meet.example.org', tokenAuth: 'none' }
    expect(meetingStatusSummary(open, { externalTeacherPasses: true }).detail).toMatch(/anyone with a room link/)
  })
})
