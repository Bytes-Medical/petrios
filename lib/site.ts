/**
 * Site identity constants shared by SEO surfaces (layout metadata,
 * sitemap.ts, robots.ts, JSON-LD). Build-safe: unlike lib/app-url's
 * getAppUrl(), this never throws — metadata is evaluated at build time
 * where placeholder env is legitimate.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')

export const SITE_NAME = 'Byte Teaching'

export const SITE_TAGLINE = 'The operating system for clinical teaching'

export const SITE_DESCRIPTION =
  'Open-source teaching management for NHS and clinical education programmes: evidence-based attendance, built-in video, claimable teaching slots, anonymous feedback with AI summaries, ARCP portfolio evidence, and an approval-gated AI assistant. Self-hostable, API-first, AGPL-3.0.'

export const GITHUB_URL = 'https://github.com/Bytes-Medical/bytes-teaching'
