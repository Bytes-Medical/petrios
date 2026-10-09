import type { MeetingConfig } from './types'

/**
 * Operator-facing summary of the Petrios Meet configuration for the
 * installation page (/settings/installation, super admins only). Names the
 * mode and, on a configuration error, the error text, which by design names
 * variables only (lib/meeting/config.ts), never values.
 */
export interface MeetingStatusSummary {
  ready: boolean
  mode: string
  detail: string
}

export function meetingStatusSummary(
  config: MeetingConfig,
  options: { externalTeacherPasses: boolean }
): MeetingStatusSummary {
  if (!config.ok) {
    return {
      ready: false,
      mode: 'Unavailable (configuration error)',
      detail: `${config.error} Participants see "Video rooms are unavailable" until this is fixed.`,
    }
  }
  if (config.mode === 'public') {
    return {
      ready: true,
      mode: 'meet.jit.si (public, opens in a new tab)',
      detail:
        'No video settings are configured. Rooms open on the free meet.jit.si service in a new tab, and the first person to arrive must sign in to Jitsi. Set JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY (docs/petrios-meet.md) for embedded rooms.',
    }
  }
  const teacherNote = options.externalTeacherPasses
    ? 'Accepted external teachers join from their invitation link.'
    : 'External teachers cannot get a room pass until TEACHER_INVITATIONS_RLS_LOCKED=true (after the teacher_invitations policy fix in spec/13).'
  if (config.mode === 'jaas') {
    return {
      ready: true,
      mode: '8x8 Jitsi as a Service (JaaS), embedded',
      detail: `Every participant joins with a Petrios room pass signed for AppID ${config.appId}. ${teacherNote}`,
    }
  }
  if (config.tokenAuth === 'hs256') {
    return {
      ready: true,
      mode: `Self-hosted Jitsi (${config.domain}), embedded with room passes`,
      detail: `Moderator rights and token-only entry depend on your Jitsi server settings (docs/self-hosting.md). ${teacherNote}`,
    }
  }
  return {
    ready: true,
    mode: `Self-hosted Jitsi (${config.domain}), embedded, open rooms`,
    detail: 'Rooms need no pass: anyone with a room link can enter it.',
  }
}
