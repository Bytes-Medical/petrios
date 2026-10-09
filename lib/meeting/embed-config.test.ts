import { describe, expect, it } from 'vitest'
import { buildEmbedConfig, meetingIframeTitle } from './embed-config'

describe('buildEmbedConfig', () => {
  it('starts with the device check, muted, inside the page', () => {
    const config = buildEmbedConfig('Acute kidney injury')
    expect(config.prejoinConfig).toEqual({ enabled: true })
    expect(config.startWithAudioMuted).toBe(true)
    // Mobile browsers would otherwise be sent to the Jitsi app instead of the room.
    expect(config.disableDeepLinking).toBe(true)
  })

  it('keeps room access with Petrios and makes no third-party lookups', () => {
    const config = buildEmbedConfig('Acute kidney injury')
    expect(config.disableInviteFunctions).toBe(true)
    expect(config.disableThirdPartyRequests).toBe(true)
  })

  it('uses the session title as the room subject', () => {
    expect(buildEmbedConfig('  Acute kidney injury ').subject).toBe('Acute kidney injury')
    expect(buildEmbedConfig('   ').subject).toBe('Petrios session')
  })

  it('locks the display name only when a room pass names the participant', () => {
    expect(buildEmbedConfig('T', { lockDisplayName: true }).readOnlyName).toBe(true)
    expect(buildEmbedConfig('T', { lockDisplayName: false })).not.toHaveProperty('readOnlyName')
    expect(buildEmbedConfig('T')).not.toHaveProperty('readOnlyName')
  })

  it('carries no participant identity (that comes from the room pass)', () => {
    const config = buildEmbedConfig('T', { lockDisplayName: true })
    for (const key of ['userInfo', 'email', 'jwt', 'displayName']) {
      expect(config).not.toHaveProperty(key)
    }
  })
})

describe('meetingIframeTitle', () => {
  it('names the room for assistive technology', () => {
    expect(meetingIframeTitle('Acute kidney injury')).toBe(
      'Petrios Meet video room: Acute kidney injury'
    )
    expect(meetingIframeTitle('')).toBe('Petrios Meet video room: Petrios session')
  })
})
