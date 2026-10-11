import { looksLikeRsaPrivateKeyDer, pemToDer } from './jwt'
import type { MeetingConfig } from './types'

/**
 * Petrios Meet backend resolution: the ONE place that decides, from the
 * environment, which meeting service the deployment uses.
 *
 *   jaas         JAAS_APP_ID + JAAS_API_KEY_ID + JAAS_PRIVATE_KEY  → 8x8.vc, embedded, RS256 passes
 *   self-hosted  JITSI_DOMAIN=<your host> (+ JITSI_APP_ID/JITSI_APP_SECRET for HS256 passes)
 *   public       nothing set (or JITSI_DOMAIN=meet.jit.si)          → link out to meet.jit.si
 *
 * Every value is trimmed and an empty value counts as unset. Values are read
 * at REQUEST time (never baked into a bundle), so a Worker or Docker env
 * change needs no rebuild. A partial or contradictory configuration is a
 * configuration ERROR: meetings become unavailable with a message that names
 * variables, never secret values. There is no silent fallback to meet.jit.si.
 *
 * Pure over `env` and free of `server-only`, because proxy.ts (security
 * headers) uses it. Client code must not import it: in the browser the env is
 * empty, so it would resolve the wrong mode (not a leak, just wrong).
 */

export const JAAS_DOMAIN = '8x8.vc'
export const JAAS_ORIGIN = 'https://8x8.vc'
export const PUBLIC_JITSI_DOMAIN = 'meet.jit.si'
export const PUBLIC_JITSI_ORIGIN = 'https://meet.jit.si'
/** Default `aud` for self-hosted HS256 room passes (jitsi-meet token docs). */
export const DEFAULT_SELF_HOSTED_AUDIENCE = 'jitsi'

type Env = Record<string, string | undefined>

const JAAS_VARS = ['JAAS_APP_ID', 'JAAS_API_KEY_ID', 'JAAS_PRIVATE_KEY'] as const
const SELF_HOSTED_TOKEN_VARS = [
  'JITSI_APP_ID',
  'JITSI_APP_SECRET',
  'JITSI_JWT_AUDIENCE',
  'JITSI_JWT_SUBJECT',
] as const

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const DOMAIN_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::(\\d{1,5}))?$`)
const JAAS_APP_ID_PATTERN = /^vpaas-magic-cookie-[A-Za-z0-9]+$/
const JAAS_KEY_ID_PATTERN = /^[A-Za-z0-9/_-]+$/
const TOKEN_CLAIM_PATTERN = /^[A-Za-z0-9._:*-]{1,253}$/

export const MEETING_CONFIG_ERRORS = {
  domain: 'JITSI_DOMAIN must be a hostname with an optional port (no scheme or path).',
  jaasWithSelfHostedVars:
    'JITSI_APP_ID, JITSI_APP_SECRET, JITSI_JWT_AUDIENCE and JITSI_JWT_SUBJECT apply only to a self-hosted JITSI_DOMAIN.',
  jaasAppId: 'JAAS_APP_ID must be the AppID from the JaaS console (vpaas-magic-cookie-…).',
  jaasKeyId:
    'JAAS_API_KEY_ID must be the API key id from the JaaS console; it starts with JAAS_APP_ID followed by "/".',
  jaasPrivateKey:
    'JAAS_PRIVATE_KEY must be a PEM RSA private key (BEGIN PRIVATE KEY or BEGIN RSA PRIVATE KEY).',
  jaasDomainWithoutJaas:
    '8x8.vc rooms need JaaS: set JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY.',
  halfSelfHostedToken:
    'Set both JITSI_APP_ID and JITSI_APP_SECRET for token-protected rooms, or neither.',
  claimsWithoutToken:
    'JITSI_JWT_AUDIENCE and JITSI_JWT_SUBJECT need JITSI_APP_ID and JITSI_APP_SECRET.',
} as const

function read(env: Env, name: string): string | null {
  const value = env[name]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function unavailable(error: string): MeetingConfig {
  return { ok: false, mode: 'unavailable', error }
}

const PEM_BLOCK = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]*?)-----END (RSA )?PRIVATE KEY-----/

/**
 * Normalize an operator-supplied private key: surrounding quotes, literal
 * "\n" / "\r\n" escapes (single-line env UIs), CRLF line endings and stray
 * whitespace. Returns a canonical 64-column PEM, or null when there is no
 * well-formed RSA PEM block (PKCS#8 "PRIVATE KEY" or PKCS#1 "RSA PRIVATE
 * KEY"; encrypted and EC keys are rejected).
 */
export function normalizePrivateKeyPem(
  raw: string
): { pem: string; format: 'pkcs8' | 'pkcs1' } | null {
  let text = raw.trim()
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text[text.length - 1] === text[0]) {
    text = text.slice(1, -1).trim()
  }
  text = text.replace(/\\r\\n|\\n|\\r/g, '\n').replace(/\r\n?/g, '\n')

  const match = PEM_BLOCK.exec(text)
  if (!match) return null
  const [, beginRsa, rawBody, endRsa] = match
  if ((beginRsa ?? '') !== (endRsa ?? '')) return null

  const body = rawBody.replace(/\s+/g, '')
  if (!body || body.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null

  const label = beginRsa ? 'RSA PRIVATE KEY' : 'PRIVATE KEY'
  const lines = body.match(/.{1,64}/g) ?? []
  return {
    pem: `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`,
    format: beginRsa ? 'pkcs1' : 'pkcs8',
  }
}

function isUsableRsaPem(raw: string): boolean {
  const normalized = normalizePrivateKeyPem(raw)
  if (!normalized) return false
  try {
    return looksLikeRsaPrivateKeyDer(pemToDer(normalized.pem), normalized.format)
  } catch {
    return false
  }
}

/** Host without port, lower-case (the default self-hosted `sub`). */
function hostOf(domain: string): string {
  return domain.replace(/:\d+$/, '')
}

function isJaasHost(domain: string): boolean {
  const host = hostOf(domain)
  return host === JAAS_DOMAIN || host.endsWith(`.${JAAS_DOMAIN}`)
}

/** Resolve the meeting backend from an environment (default `process.env`). */
export function resolveMeetingConfig(env: Env = process.env): MeetingConfig {
  const domainRaw = read(env, 'JITSI_DOMAIN') ?? read(env, 'NEXT_PUBLIC_JITSI_DOMAIN')
  const domain = domainRaw?.toLowerCase() ?? null

  // 1. Domain syntax (also blocks header injection into the CSP).
  if (domain !== null) {
    const match = domain.length <= 253 ? DOMAIN_PATTERN.exec(domain) : null
    const port = match?.[1] ? Number(match[1]) : null
    if (!match || (port !== null && (port < 1 || port > 65535))) {
      return unavailable(MEETING_CONFIG_ERRORS.domain)
    }
  }

  const jaasSet = JAAS_VARS.filter((name) => read(env, name) !== null)
  const selfHostedTokenSet = SELF_HOSTED_TOKEN_VARS.filter((name) => read(env, name) !== null)
  const isPublicDomain = domain === null || hostOf(domain) === PUBLIC_JITSI_DOMAIN

  // 2. Partial JaaS.
  if (jaasSet.length > 0 && jaasSet.length < JAAS_VARS.length) {
    const missing = JAAS_VARS.filter((name) => !jaasSet.includes(name))
    return unavailable(
      `JaaS is partly configured: set all of JAAS_APP_ID, JAAS_API_KEY_ID and JAAS_PRIVATE_KEY (missing: ${missing.join(', ')}).`
    )
  }

  if (jaasSet.length === JAAS_VARS.length) {
    // 3. JaaS with a contradictory domain.
    if (!isPublicDomain && hostOf(domain as string) !== JAAS_DOMAIN) {
      return unavailable(
        `JITSI_DOMAIN (${domain}) conflicts with JaaS: unset JITSI_DOMAIN (or set it to 8x8.vc) to use JaaS.`
      )
    }
    // 4. JaaS with self-hosted token settings.
    if (selfHostedTokenSet.length > 0) return unavailable(MEETING_CONFIG_ERRORS.jaasWithSelfHostedVars)

    const appId = read(env, 'JAAS_APP_ID') as string
    const keyId = read(env, 'JAAS_API_KEY_ID') as string
    const privateKey = read(env, 'JAAS_PRIVATE_KEY') as string
    // 5–7. Shape checks.
    if (!JAAS_APP_ID_PATTERN.test(appId)) return unavailable(MEETING_CONFIG_ERRORS.jaasAppId)
    if (!JAAS_KEY_ID_PATTERN.test(keyId) || !keyId.startsWith(`${appId}/`) || keyId.length <= appId.length + 1) {
      return unavailable(MEETING_CONFIG_ERRORS.jaasKeyId)
    }
    if (!isUsableRsaPem(privateKey)) return unavailable(MEETING_CONFIG_ERRORS.jaasPrivateKey)

    // 8.
    return { ok: true, mode: 'jaas', domain: JAAS_DOMAIN, origin: JAAS_ORIGIN, appId, tokenAuth: 'jaas-rs256' }
  }

  // 9. 8x8.vc without JaaS credentials.
  if (domain !== null && isJaasHost(domain)) return unavailable(MEETING_CONFIG_ERRORS.jaasDomainWithoutJaas)

  if (isPublicDomain) {
    // 10. Token settings cannot apply to meet.jit.si.
    if (selfHostedTokenSet.length > 0) return unavailable(MEETING_CONFIG_ERRORS.jaasWithSelfHostedVars)
    // 11.
    return {
      ok: true,
      mode: 'public',
      domain: PUBLIC_JITSI_DOMAIN,
      origin: PUBLIC_JITSI_ORIGIN,
      tokenAuth: 'none',
    }
  }

  const selfHostedDomain = domain as string
  const origin = `https://${selfHostedDomain}`
  const appId = read(env, 'JITSI_APP_ID')
  const secret = read(env, 'JITSI_APP_SECRET')
  const audience = read(env, 'JITSI_JWT_AUDIENCE')
  const subject = read(env, 'JITSI_JWT_SUBJECT')

  // 12. Half a token configuration.
  if ((appId === null) !== (secret === null)) return unavailable(MEETING_CONFIG_ERRORS.halfSelfHostedToken)
  // 16. Open self-hosted room (the pre-token behaviour).
  if (appId === null) {
    // 13. Claim overrides without a token configuration.
    if (audience !== null || subject !== null) return unavailable(MEETING_CONFIG_ERRORS.claimsWithoutToken)
    return { ok: true, mode: 'self-hosted', domain: selfHostedDomain, origin, tokenAuth: 'none' }
  }

  // 14. Claim shapes.
  for (const [name, value] of [
    ['JITSI_APP_ID', appId],
    ['JITSI_JWT_AUDIENCE', audience],
    ['JITSI_JWT_SUBJECT', subject],
  ] as const) {
    if (value !== null && !TOKEN_CLAIM_PATTERN.test(value)) {
      return unavailable(`${name} may contain only letters, digits and . _ : * - (at most 253 characters).`)
    }
  }

  // 15. Token-protected self-hosted rooms.
  return {
    ok: true,
    mode: 'self-hosted',
    domain: selfHostedDomain,
    origin,
    tokenAuth: 'hs256',
    appId,
    audience: audience ?? DEFAULT_SELF_HOSTED_AUDIENCE,
    subject: subject ?? hostOf(selfHostedDomain),
  }
}

const ALL_MEETING_VARS = ['JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', ...JAAS_VARS, ...SELF_HOSTED_TOKEN_VARS]
let memo: { key: string; config: MeetingConfig } | null = null

/**
 * `resolveMeetingConfig(process.env)`, memoised on the raw values so the
 * proxy (every request) does not re-parse the PEM, while an env change is
 * still picked up immediately.
 *
 * A configuration error is logged ONCE per distinct environment, the first
 * time anything resolves it (the proxy runs on the first request, so a bad
 * deployment shows up in the logs at once, not when a trainee clicks Join).
 * The message names variables only, never values.
 */
export function getMeetingConfig(): MeetingConfig {
  const key = ALL_MEETING_VARS.map((name) => process.env[name] ?? '\u0000').join('\u0001')
  if (memo && memo.key === key) return memo.config
  const config = resolveMeetingConfig(process.env)
  memo = { key, config }
  if (!config.ok) console.error('[petrios-meet] configuration error:', config.error)
  return config
}

/** Test hook: forget the memoised configuration (and so its logged error). */
export function resetMeetingConfigForTests(): void {
  memo = null
}

/**
 * The origin to delegate in CSP frame-src/script-src/connect-src and the
 * Permissions-Policy: the embedded service's origin for jaas/self-hosted;
 * null for public mode (opened as a top-level tab, nothing embedded) and for
 * a configuration error (meetings unavailable).
 */
export function meetingEmbedOrigin(config: MeetingConfig): string | null {
  if (!config.ok || config.mode === 'public') return null
  return config.origin
}
