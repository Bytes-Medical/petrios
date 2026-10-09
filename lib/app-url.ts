import { headers } from 'next/headers'

const LOCAL_APP_URL = 'http://localhost:3000'

const APP_URL_ENV_KEYS = [
  'APP_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_BASE_URL',
  'NEXTAUTH_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'VERCEL_URL',
  'RENDER_EXTERNAL_URL',
] as const

function normalizeAppUrl(value: string | undefined | null) {
  const candidate = value?.trim()
  if (!candidate) return null

  const isLocalHost =
    candidate.startsWith('localhost') ||
    candidate.startsWith('127.0.0.1') ||
    candidate.startsWith('[::1]')
  const urlWithProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `${isLocalHost ? 'http' : 'https'}://${candidate}`

  try {
    return new URL(urlWithProtocol).origin
  } catch {
    return null
  }
}

function getConfiguredAppUrl() {
  for (const key of APP_URL_ENV_KEYS) {
    const appUrl = normalizeAppUrl(process.env[key])
    if (appUrl) return appUrl
  }

  return null
}

function getFirstHeaderValue(value: string | null) {
  return value?.split(',')[0]?.trim() || null
}

function isLocalAppUrl(appUrl: string) {
  const { hostname } = new URL(appUrl)
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function assertUsableProductionUrl(appUrl: string | null) {
  if (process.env.NODE_ENV === 'production' && (!appUrl || isLocalAppUrl(appUrl))) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL must be set to the public app URL before sending email links.'
    )
  }
}

export function getAppUrl() {
  const appUrl = getConfiguredAppUrl()
  assertUsableProductionUrl(appUrl)
  return appUrl || LOCAL_APP_URL
}

export async function getAppUrlFromHeaders() {
  const envUrl = getConfiguredAppUrl()
  if (envUrl) return envUrl

  const h = await headers()
  const host =
    getFirstHeaderValue(h.get('x-forwarded-host')) || getFirstHeaderValue(h.get('host'))
  if (host) {
    const proto =
      getFirstHeaderValue(h.get('x-forwarded-proto')) ||
      (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
    const headerUrl = normalizeAppUrl(`${proto}://${host}`)
    assertUsableProductionUrl(headerUrl)
    if (headerUrl) return headerUrl
  }

  assertUsableProductionUrl(null)
  return LOCAL_APP_URL
}
