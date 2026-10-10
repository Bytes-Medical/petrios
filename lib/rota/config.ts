/**
 * Rota availability configuration (spec/14). Server-only by convention: the
 * browser has no access to these variables, so client components must never
 * import this module (they would always see "off").
 *
 *   ROTA_INTEGRATION_ENABLED  exactly "true" turns the feature on; anything
 *                             else (unset, "TRUE", "1") is off.
 *   ROTA_IDENTITY_SECRET      at least 32 bytes (UTF-8); keys the HMAC that
 *                             identity links store. Missing or short means the
 *                             feature is UNAVAILABLE, never a weaker fallback.
 *
 * Values are read at request time, so a Render or Worker env change needs
 * no rebuild. The secret value is never logged.
 */

export { ROTA_LIMITS } from './schema'

export const ROTA_KILL_SWITCH_ENV = 'ROTA_INTEGRATION_ENABLED'
export const ROTA_IDENTITY_SECRET_ENV = 'ROTA_IDENTITY_SECRET'
export const ROTA_IDENTITY_SECRET_MIN_BYTES = 32

type Env = Record<string, string | undefined>

function defaultEnv(): Env {
  return typeof process === 'undefined' ? {} : process.env
}

export function isRotaKillSwitchOn(env: Env = defaultEnv()): boolean {
  return env[ROTA_KILL_SWITCH_ENV] === 'true'
}

let secretProblemLogged = false

/** Test hook: lets a test observe the one-time log again. */
export function resetRotaConfigLogForTests(): void {
  secretProblemLogged = false
}

export function getRotaIdentitySecret(env: Env = defaultEnv()): Uint8Array | null {
  const raw = env[ROTA_IDENTITY_SECRET_ENV]
  const value = typeof raw === 'string' ? raw.trim() : ''
  const bytes = new TextEncoder().encode(value)
  if (bytes.length >= ROTA_IDENTITY_SECRET_MIN_BYTES) return bytes
  if (!secretProblemLogged) {
    secretProblemLogged = true
    console.error('[rota] ROTA_IDENTITY_SECRET missing or too short')
  }
  return null
}
