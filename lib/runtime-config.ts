/** Public installation settings. Read aliases indirectly so Next never bakes them into a bundle. */
export interface PublicRuntimeConfig {
  appUrl: string
  supabaseUrl: string
  supabaseAnonKey: string
  jitsiDomain: string
}

function env(primary: string, legacy: string, fallback = ''): string {
  return process.env[primary] || process.env[legacy] || fallback
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  if (typeof window !== 'undefined') {
    const source = document.getElementById('petrios-runtime-config')?.textContent
    if (!source) throw new Error('Petrios runtime configuration is unavailable. Reload this page.')
    return JSON.parse(source) as PublicRuntimeConfig
  }
  return {
    appUrl: env('APP_URL', 'NEXT_PUBLIC_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
    supabaseUrl: env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:8000').replace(/\/$/, ''),
    supabaseAnonKey: env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    jitsiDomain: env('JITSI_DOMAIN', 'NEXT_PUBLIC_JITSI_DOMAIN', 'meet.jit.si'),
  }
}

export function validatePublicRuntimeConfig(config: PublicRuntimeConfig): void {
  for (const name of ['appUrl', 'supabaseUrl'] as const) {
    const url = new URL(config[name])
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error(`${name} must be an HTTP(S) origin without credentials or a path`)
    }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error(`${name} must use HTTPS outside localhost`)
    }
  }
  if (!config.supabaseAnonKey) throw new Error('SUPABASE_ANON_KEY is required')
  if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(config.jitsiDomain)) throw new Error('JITSI_DOMAIN must be a hostname')
}

/** Safe for an inert application/json script element, including hostile operator-supplied values. */
export function serializePublicRuntimeConfig(config: PublicRuntimeConfig): string {
  return JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
