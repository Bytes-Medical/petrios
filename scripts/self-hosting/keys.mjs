import { createHmac } from 'node:crypto'
/** Stable legacy API credentials. Fixed claims prevent restart/release changes breaking signed links. */
export function apiKey(secret, role) {
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters')
  if (!['anon', 'service_role'].includes(role)) throw new Error('Invalid API role')
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  // Long-lived infrastructure keys; rotate the installation JWT_SECRET to revoke them.
  const payload = Buffer.from(JSON.stringify({ role, iss: 'supabase', iat: 0, exp: 2147483647 })).toString('base64url')
  const body = `${header}.${payload}`
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
export function configureKeys() {
  if (!process.env.JWT_SECRET) return
  process.env.SUPABASE_ANON_KEY ||= apiKey(process.env.JWT_SECRET, 'anon')
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= apiKey(process.env.JWT_SECRET, 'service_role')
  process.env.ANON_KEY ||= process.env.SUPABASE_ANON_KEY
  process.env.SERVICE_KEY ||= process.env.SUPABASE_SERVICE_ROLE_KEY
}
