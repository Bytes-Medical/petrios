import type { NextResponse } from 'next/server'
import { getMeetingConfig, meetingEmbedOrigin } from './meeting/config'
import { getPublicRuntimeConfig } from './runtime-config'

/**
 * Global browser security headers, applied by proxy.ts.
 *
 * The meeting origin is delegated ONLY when a room is embedded
 * (meetingEmbedOrigin): JaaS → https://8x8.vc (react-sdk loads
 * https://8x8.vc/<AppID>/external_api.js, covered by the origin source), or
 * the self-hosted Jitsi origin. In public mode meet.jit.si is opened as a
 * top-level tab, so no script, frame, connection or device access is
 * delegated; a configuration error delegates nothing either. Petrios itself
 * never uses camera, microphone or screen capture.
 */
export function applySecurityHeaders(response: NextResponse): NextResponse {
  const config = getPublicRuntimeConfig()
  const meeting = meetingEmbedOrigin(getMeetingConfig())
  const websocket = (origin: string) => origin.replace(/^http/, 'ws')
  const meetingSource = meeting ? ` ${meeting}` : ''
  const meetingConnect = meeting ? ` ${meeting} ${websocket(meeting)}` : ''
  const secure = config.appUrl.startsWith('https://')
  const development = process.env.NODE_ENV === 'development'
  response.headers.set('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}${meetingSource}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:",
    "media-src 'self' blob:", "worker-src 'self' blob:", `frame-src 'self'${meetingSource}`,
    `connect-src 'self' ${config.supabaseUrl} ${websocket(config.supabaseUrl)}${meetingConnect}${development ? ' ws://localhost:* http://localhost:*' : ''}`,
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; '))
  if (secure) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  const device = meeting ? `(self "${meeting}")` : '()'
  const media = meeting ? `(self "${meeting}")` : '(self)'
  response.headers.set('Permissions-Policy', `accelerometer=(), autoplay=${media}, camera=${device}, display-capture=${device}, fullscreen=${media}, geolocation=(), gyroscope=(), magnetometer=(), microphone=${device}, payment=(), usb=()`)
  return response
}
