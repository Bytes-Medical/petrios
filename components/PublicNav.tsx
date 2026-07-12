'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Wordmark } from './Wordmark'

const LINKS = [
  { href: '/features', key: 'features', label: 'Features' },
  { href: '/news', key: 'news', label: 'News' },
  { href: '/open-source', key: 'open-source', label: 'Open Source' },
  { href: '/contributors', key: 'contributors', label: 'Contributors' },
] as const

/**
 * Navigation for the public (signed-out) site. Inline links on desktop,
 * hamburger menu on mobile — Sign in stays visible at every width. The
 * signed-in app uses NavShell/Nav instead.
 */
export function PublicNav({ current }: { current?: (typeof LINKS)[number]['key'] }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const linkClass = (key: string) =>
    current === key
      ? 'underline underline-offset-4 decoration-clay-600 decoration-2'
      : 'hover:underline hover:underline-offset-4'

  return (
    <nav className="border-b border-black bg-white">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" onClick={() => setMenuOpen(false)}>
            <Wordmark />
          </Link>

          {/* Desktop links */}
          <div className="hidden items-center gap-x-4 font-mono text-sm md:flex">
            {LINKS.map((link) => (
              <Link key={link.key} href={link.href} className={linkClass(link.key)}>
                {link.label}
              </Link>
            ))}
            <a
              href="https://github.com/Bytes-Medical/petrios"
              className="hover:underline hover:underline-offset-4"
            >
              GitHub ↗
            </a>
            <Link
              href="/login"
              className="border border-black bg-black px-3 py-1.5 text-white hover:bg-gray-800"
            >
              Sign in
            </Link>
          </div>

          {/* Mobile: Sign in stays visible + hamburger */}
          <div className="flex items-center gap-2 md:hidden">
            <Link
              href="/login"
              className="border border-black bg-black px-3 py-1.5 font-mono text-sm text-white hover:bg-gray-800"
            >
              Sign in
            </Link>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Toggle menu"
              className="border border-black p-2"
            >
              <span className="font-mono text-sm">{menuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="mt-3 flex flex-col gap-1 border-t border-black pt-3 font-mono text-sm md:hidden">
            {LINKS.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`${linkClass(link.key)} py-2`}
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://github.com/Bytes-Medical/petrios"
              className="py-2 hover:underline hover:underline-offset-4"
            >
              GitHub ↗
            </a>
          </div>
        )}
      </div>
    </nav>
  )
}
