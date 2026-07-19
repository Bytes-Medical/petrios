'use client'

import { usePathname } from 'next/navigation'
import { GITHUB_URL } from '@/lib/site'

/**
 * Minimal utility footer for the signed-in app, rendered once from the root
 * layout. Public pages keep their own marketing Footer, so this renders
 * only on app-area routes. It exists for more than looks: an AGPL network
 * service should offer users a route to the source (section 13 — every
 * self-hosted instance inherits compliance via this line), and privacy
 * information must be reachable from where data is actually processed.
 */
const APP_PREFIXES = [
  '/dashboard',
  '/sessions',
  '/departments',
  '/settings',
  '/admin',
  '/ops',
  '/certificates',
  '/audit',
  '/super-admin',
]

export function AppFooter() {
  const pathname = usePathname()
  const inApp = APP_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
  // Public feedback pages live under /sessions and /departments but carry
  // the signed-out experience — keep them footer-free.
  const isPublicLeaf =
    pathname.endsWith('/feedback') || pathname.includes('/teacher-rsvp/')
  if (!inApp || isPublicLeaf) return null

  return (
    <footer className="mt-auto border-t border-gray-200 py-4">
      <p className="px-4 text-center font-mono text-xs text-gray-400">
        © {new Date().getFullYear()} Petrios ·{' '}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.en.html"
          className="underline hover:text-gray-600"
        >
          AGPL-3.0
        </a>{' '}
        ·{' '}
        <a href={GITHUB_URL} className="underline hover:text-gray-600">
          Source
        </a>{' '}
        ·{' '}
        <a href="/privacy" className="underline hover:text-gray-600">
          Privacy
        </a>
      </p>
    </footer>
  )
}
