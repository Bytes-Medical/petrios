import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/site'

/**
 * Crawl policy: index the public marketing/verification surface, keep
 * crawlers out of the app itself (auth-gated anyway) and capability-link
 * pages (recall/claim tokens are per-person, not content).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/dashboard',
          '/ops',
          '/settings',
          '/admin',
          '/audit',
          '/super-admin',
          '/departments/',
          '/sessions/',
          '/certificates',
          '/join',
          '/login',
          '/trainee-login',
          '/signup',
          '/claim/',
          '/recall/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
