/**
 * Jitsi iframe configuration for embedded Petrios Meet rooms (JaaS and
 * self-hosted). Pure and client-safe. Passed to react-sdk's JitsiMeeting as
 * `configOverwrite`; option names are jitsi-meet config.js keys.
 */

export interface EmbedConfigOptions {
  /**
   * Lock the display name to the one in the room pass (token modes), so a
   * participant cannot rename themselves to look like the teacher.
   */
  lockDisplayName?: boolean
}

export function buildEmbedConfig(
  sessionTitle: string,
  options: EmbedConfigOptions = {}
): Record<string, unknown> {
  return {
    // Device check (camera/mic/name) before entering, and nobody joins unmuted.
    prejoinConfig: { enabled: true },
    startWithAudioMuted: true,
    // Mobile browsers stay in the page instead of being sent to the app stores.
    disableDeepLinking: true,
    // Room access comes from Petrios (session page / invitation link), not
    // from links shared out of the room.
    disableInviteFunctions: true,
    // No gravatar/third-party lookups from inside the room (data minimisation).
    disableThirdPartyRequests: true,
    ...(options.lockDisplayName ? { readOnlyName: true } : {}),
    subject: meetingSubject(sessionTitle),
  }
}

function meetingSubject(sessionTitle: string): string {
  return sessionTitle.trim() || 'Petrios session'
}

/** Accessible name for the meeting iframe. */
export function meetingIframeTitle(sessionTitle: string): string {
  return `Petrios Meet video room: ${meetingSubject(sessionTitle)}`
}
