import { meetingRoomSlug } from './location'

/**
 * Room-pass (JWT) claim templates. Pure: no env, no signing.
 *
 * Data minimisation: the meeting provider is a subprocessor, so a pass
 * carries only a display name, a per-session pseudonymous id and a moderator
 * flag. Never an email address or avatar (keys are omitted, not null:
 * Prosody rejects null user fields).
 *
 * Sources: JaaS https://developer.8x8.com/jaas/docs/api-keys-jwt and the
 * official 8x8 samples (string "true"/"false" for moderator and features);
 * self-hosted https://github.com/jitsi/lib-jitsi-meet/blob/master/doc/tokens.md.
 */

/** Hard ceiling on a pass's lifetime, whatever the room window. */
export const TOKEN_MAX_LIFETIME_SECONDS = 4 * 60 * 60
/** `nbf` is backdated slightly to tolerate provider clock skew. */
export const TOKEN_NBF_SKEW_SECONDS = 30

/** Every optional JaaS service is OFF in Petrios-issued passes. */
export const JAAS_DISABLED_FEATURES = {
  livestreaming: 'false',
  recording: 'false',
  transcription: 'false',
  'outbound-call': 'false',
  'sip-outbound-call': 'false',
  'inbound-call': 'false',
  'sip-inbound-call': 'false',
  'file-upload': 'false',
} as const

export interface MeetingTokenSubject {
  /** Opaque per-session pseudonym (pseudonymousParticipantId). */
  id: string
  /** Display name shown in the room; never an email. */
  name: string
  moderator: boolean
}

export interface TokenTimes {
  iat: number
  nbf: number
  exp: number
}

/**
 * iat = now; nbf = now − 30 s; exp = min(now + 4 h, room close), all in
 * whole seconds. Throws RangeError when the room has already closed, so a
 * pass is never valid past the room window.
 */
export function tokenTimes(now: Date, closesAt: Date): TokenTimes {
  const iat = Math.floor(now.getTime() / 1000)
  const close = Math.floor(closesAt.getTime() / 1000)
  if (!Number.isFinite(iat) || !Number.isFinite(close)) throw new RangeError('Invalid token time')
  const exp = Math.min(iat + TOKEN_MAX_LIFETIME_SECONDS, close)
  if (exp <= iat) throw new RangeError('The room window has closed')
  return { iat, nbf: iat - TOKEN_NBF_SKEW_SECONDS, exp }
}

/** The `room` claim: the derived room slug, lower-cased (Jitsi MUC rooms are lower-case). */
export function roomClaim(sessionId: string): string {
  return meetingRoomSlug(sessionId).toLowerCase()
}

function userContext(user: MeetingTokenSubject) {
  return {
    id: user.id,
    name: user.name,
    moderator: user.moderator ? 'true' : 'false',
  }
}

interface TokenInput {
  sessionId: string
  user: MeetingTokenSubject
  now: Date
  closesAt: Date
}

export interface TokenTemplate {
  header: Record<string, unknown>
  payload: Record<string, unknown>
}

/** JaaS RS256 pass, restricted to one room (`room` excludes the AppID). */
export function buildJaasToken(input: TokenInput & { appId: string; kid: string }): TokenTemplate {
  const times = tokenTimes(input.now, input.closesAt)
  return {
    header: { alg: 'RS256', typ: 'JWT', kid: input.kid },
    payload: {
      aud: 'jitsi',
      iss: 'chat',
      sub: input.appId,
      room: roomClaim(input.sessionId),
      iat: times.iat,
      nbf: times.nbf,
      exp: times.exp,
      context: {
        user: userContext(input.user),
        features: { ...JAAS_DISABLED_FEATURES },
        room: { regex: false },
      },
    },
  }
}

/** Self-hosted Prosody token-auth HS256 pass, restricted to one room. */
export function buildSelfHostedToken(
  input: TokenInput & { appId: string; audience: string; subject: string }
): TokenTemplate {
  const times = tokenTimes(input.now, input.closesAt)
  return {
    header: { alg: 'HS256', typ: 'JWT' },
    payload: {
      aud: input.audience,
      iss: input.appId,
      sub: input.subject,
      room: roomClaim(input.sessionId),
      iat: times.iat,
      nbf: times.nbf,
      exp: times.exp,
      context: {
        user: userContext(input.user),
        features: { ...JAAS_DISABLED_FEATURES },
      },
    },
  }
}

/**
 * Per-session pseudonym for the room: hex(SHA-256("petrios-meet:" +
 * sessionId + ":" + subjectKey)).slice(0, 32). Stable for one person in one
 * session (rejoins match), unlinkable across sessions without the inputs.
 * subjectKey is 'user:<uuid>' or 'invitation:<uuid>'.
 */
export async function pseudonymousParticipantId(sessionId: string, subjectKey: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`petrios-meet:${sessionId}:${subjectKey}`)
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}
