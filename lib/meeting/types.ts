/**
 * Petrios Meet shared types. Type-only module: safe to import from client
 * components, server components, server actions and the proxy.
 *
 * Three meeting backends are resolved on the SERVER from the environment
 * (lib/meeting/config.ts):
 *   - 'jaas'        8x8 Jitsi as a Service (8x8.vc), embedded, RS256 room passes
 *   - 'self-hosted' the operator's Jitsi, embedded, optional HS256 room passes
 *   - 'public'      the free meet.jit.si service, opened in a new tab (never
 *                   embedded: meet.jit.si cuts embedded calls after 5 minutes)
 */

export type MeetingMode = 'jaas' | 'self-hosted' | 'public'

export type MeetingTokenAuth = 'jaas-rs256' | 'hs256' | 'none'

/**
 * Resolved meeting configuration. Never carries a secret: the JaaS private
 * key and the self-hosted app secret are read only at mint time
 * (lib/meeting/token.ts).
 */
export type MeetingConfig =
  | {
      ok: true
      mode: 'jaas'
      domain: '8x8.vc'
      origin: 'https://8x8.vc'
      appId: string
      tokenAuth: 'jaas-rs256'
    }
  | {
      ok: true
      mode: 'self-hosted'
      domain: string
      origin: string
      tokenAuth: 'hs256'
      appId: string
      audience: string
      subject: string
    }
  | {
      ok: true
      mode: 'self-hosted'
      domain: string
      origin: string
      tokenAuth: 'none'
    }
  | {
      ok: true
      mode: 'public'
      domain: 'meet.jit.si'
      origin: 'https://meet.jit.si'
      tokenAuth: 'none'
    }
  | { ok: false; mode: 'unavailable'; error: string }

export type MeetingDenialReason =
  | 'not_signed_in'
  | 'not_found'
  | 'invalid_invitation'
  | 'not_accepted'
  | 'not_video'
  | 'not_published'
  | 'cancelled'
  | 'too_early'
  | 'ended'
  | 'not_embedded'
  | 'unavailable'

export interface MeetingJoin {
  /** '8x8.vc' or the self-hosted host[:port]. */
  domain: string
  /** JaaS: '<appId>/Petrios-<uuid>'; self-hosted: 'Petrios-<uuid>'. */
  roomName: string
  /** Null only for open (token-less) self-hosted rooms. */
  jwt: string | null
  /** ISO expiry of `jwt`; null when `jwt` is null. */
  expiresAt: string | null
  moderator: boolean
  /** Shown to the room. Never an email address. */
  displayName: string
}

export type MeetingJoinResult =
  | { ok: true; join: MeetingJoin }
  | {
      ok: false
      reason: MeetingDenialReason
      message: string
      retryable: boolean
      /** ISO room-open time, present for 'too_early'. */
      opensAt?: string
    }

export type MeetingCheckInResult =
  | { ok: true; message: string }
  | {
      ok: false
      reason:
        | 'not_signed_in'
        | 'not_available'
        | 'finalized'
        | 'outside_window'
        | 'code_required'
        | 'failed'
      message: string
      /** Self check-in window (ISO), present for 'outside_window'. */
      window?: { opensAt: string; closesAt: string }
    }

export interface MeetingRoomView {
  sessionId: string
  sessionTitle: string
  mode: MeetingMode | 'unavailable'
  /** True when mode is 'jaas' or 'self-hosted'. */
  embedded: boolean
  availability: 'ready' | 'not_published' | 'cancelled' | 'unavailable'
  /** ISO, server-computed room window. */
  opensAt: string
  closesAt: string
  /** ISO, for client clock-skew correction. */
  serverNow: string
  /** Public mode only: https://meet.jit.si/Petrios-<uuid>. */
  publicRoomUrl: string | null
  displayName: string
  /** The profile has no name, so the room shows the generic fallback. */
  displayNameIsFallback: boolean
  /**
   * The viewer hosts this room (department moderator or ACCEPTED teacher,
   * computed on the server). Hosts are not self-checked-in on joining.
   */
  viewerIsModerator: boolean
  /** Generic, user-safe text when availability === 'unavailable'. */
  unavailableMessage: string | null
}

export type MeetingAudience =
  | { kind: 'member' }
  | { kind: 'external_teacher'; inviteCode: string }
