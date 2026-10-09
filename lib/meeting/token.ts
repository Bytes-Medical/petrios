import 'server-only'
import { buildJaasToken, buildSelfHostedToken, type MeetingTokenSubject } from './claims'
import { normalizePrivateKeyPem } from './config'
import { MeetingKeyError, signJwtHs256, signJwtRs256 } from './jwt'
import type { MeetingConfig } from './types'

/**
 * Mint a Petrios Meet room pass. The only module that reads the signing
 * secrets (JAAS_PRIVATE_KEY, JITSI_APP_SECRET), and only at mint time.
 * Never logs a token or key. An unusable key throws MeetingKeyError, which
 * callers map to "video rooms unavailable".
 */
export async function mintMeetingToken(
  config: Extract<MeetingConfig, { ok: true }>,
  input: { sessionId: string; user: MeetingTokenSubject; now: Date; closesAt: Date },
  env: Record<string, string | undefined> = process.env
): Promise<{ jwt: string | null; expiresAt: string | null }> {
  if (config.tokenAuth === 'none') return { jwt: null, expiresAt: null }

  if (config.tokenAuth === 'jaas-rs256') {
    const kid = env.JAAS_API_KEY_ID?.trim()
    const raw = env.JAAS_PRIVATE_KEY
    const normalized = raw ? normalizePrivateKeyPem(raw) : null
    if (!kid || !normalized) throw new MeetingKeyError('JaaS signing settings are missing or malformed.')
    const { header, payload } = buildJaasToken({ ...input, appId: config.appId, kid })
    const jwt = await signJwtRs256(header, payload, normalized.pem)
    return { jwt, expiresAt: new Date((payload.exp as number) * 1000).toISOString() }
  }

  const secret = env.JITSI_APP_SECRET?.trim()
  if (!secret) throw new MeetingKeyError('JITSI_APP_SECRET is missing.')
  const { header, payload } = buildSelfHostedToken({
    ...input,
    appId: config.appId,
    audience: config.audience,
    subject: config.subject,
  })
  const jwt = await signJwtHs256(header, payload, secret)
  return { jwt, expiresAt: new Date((payload.exp as number) * 1000).toISOString() }
}
