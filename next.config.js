function httpsOrigin(value, fallback) {
  const candidate = value || fallback
  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : fallback
  } catch {
    return fallback
  }
}

function websocketOrigin(origin) {
  return origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
}

const supabaseOrigin = httpsOrigin(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  'https://*.supabase.co'
)
const jitsiOrigin = httpsOrigin(
  process.env.NEXT_PUBLIC_JITSI_DOMAIN,
  'https://meet.jit.si'
)

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} ${jitsiOrigin}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `frame-src 'self' ${jitsiOrigin}`,
  `connect-src 'self' ${supabaseOrigin} ${websocketOrigin(supabaseOrigin)} ${jitsiOrigin} ${websocketOrigin(jitsiOrigin)}${process.env.NODE_ENV === 'development' ? ' ws://localhost:* http://localhost:*' : ''}`,
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ')

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy,
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: `accelerometer=(), autoplay=(self "${jitsiOrigin}"), camera=(self "${jitsiOrigin}"), display-capture=(self "${jitsiOrigin}"), fullscreen=(self "${jitsiOrigin}"), geolocation=(), gyroscope=(), magnetometer=(), microphone=(self "${jitsiOrigin}"), payment=(), usb=()`,
  },
  {
    key: 'X-Permitted-Cross-Domain-Policies',
    value: 'none',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (docs/self-hosting.md).
  output: 'standalone',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
