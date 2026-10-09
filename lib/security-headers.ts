import type { NextResponse } from 'next/server'
import { getPublicRuntimeConfig } from './runtime-config'

export function applySecurityHeaders(response: NextResponse): NextResponse {
  const config = getPublicRuntimeConfig()
  const jitsi = `https://${config.jitsiDomain}`
  const websocket = (origin: string) => origin.replace(/^http/, 'ws')
  const secure = config.appUrl.startsWith('https://')
  const development = process.env.NODE_ENV === 'development'
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''} ${jitsi}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
    "media-src 'self' blob:", "worker-src 'self' blob:", `frame-src 'self' ${jitsi}`,
    `connect-src 'self' ${config.supabaseUrl} ${websocket(config.supabaseUrl)} ${jitsi} ${websocket(jitsi)}${development ? ' ws://localhost:* http://localhost:*' : ''}`,
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; '))
  if (secure) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  response.headers.set('Permissions-Policy', `accelerometer=(), autoplay=(self "${jitsi}"), camera=(self "${jitsi}"), display-capture=(self "${jitsi}"), fullscreen=(self "${jitsi}"), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self "${jitsi}"), payment=(), usb=()`)
  return response
}
