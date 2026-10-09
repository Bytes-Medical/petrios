'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { HudWordmark } from '@/components/hud/HudWordmark'
import { hudLink } from '@/components/hud/HudLink'
import s from '@/components/hud/hud.module.css'
import { GITHUB_URL } from '@/lib/site'

const LINKS = [
  { href: '/features', key: 'features', label: 'Features' },
  { href: '/news', key: 'news', label: 'News' },
  { href: '/open-source', key: 'open-source', label: 'Open source' },
  { href: '/contributors', key: 'contributors', label: 'Contributors' },
] as const

export type PublicNavKey = (typeof LINKS)[number]['key']

const EXTERNAL_ARROW = <span aria-hidden="true">{' ↗'}</span>

const noopSubscribe = () => () => {}

/**
 * Navigation for the public (signed-out) site, rendered by HudShell. Inline
 * links from 768px, a menu below; Sign in stays visible at every width. The
 * menu button is disabled until hydrated, so without JavaScript it honestly
 * does nothing (the footer still links every page). The ruler under it is
 * decorative (5 mm ticks, a tall tick every 1 s at 50 mm/s). The signed-in
 * app uses NavShell/Nav instead.
 */
export function PublicNav({ current }: { current?: PublicNavKey }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      button.current?.focus()
    }
    const wide = window.matchMedia('(min-width: 768px)')
    const onWide = () => {
      if (wide.matches) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    wide.addEventListener('change', onWide)
    return () => {
      document.removeEventListener('keydown', onKey)
      wide.removeEventListener('change', onWide)
    }
  }, [open])

  const close = () => setOpen(false)
  const currentProps = (key: PublicNavKey) => (current === key ? { 'aria-current': 'page' as const } : {})

  return (
    <nav aria-label="Main" className={s.nav}>
      <div className={s.navInner}>
        <Link href="/" className={s.navHome} aria-label="Petrios home" onClick={close}>
          <HudWordmark size="sm" />
        </Link>
        <ul className={s.navLinks}>
          {LINKS.map((link) => (
            <li key={link.key}>
              <Link href={link.href} className={s.navLink} {...currentProps(link.key)}>
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={GITHUB_URL} className={s.navLink}>
              GitHub{EXTERNAL_ARROW}
            </a>
          </li>
        </ul>
        <div className={s.navActions}>
          <Link href="/login" className={hudLink({ variant: 'ink', size: 'sm' })}>
            Sign in
          </Link>
          <button
            ref={button}
            type="button"
            className={s.menuButton}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="public-menu"
            disabled={!hydrated}
            onClick={() => setOpen((value) => !value)}
          >
            <svg className={s.iconMenu} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M1 3.5h14M1 8h14M1 12.5h14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <svg className={s.iconClose} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M2.5 2.5l11 11M13.5 2.5l-11 11" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
        </div>
      </div>
      <div id="public-menu" className={s.menu} hidden={!open}>
        <ul>
          {LINKS.map((link) => (
            <li key={link.key}>
              <Link href={link.href} className={s.menuLink} onClick={close} {...currentProps(link.key)}>
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <a href={GITHUB_URL} className={s.menuLink} onClick={close}>
              GitHub{EXTERNAL_ARROW}
            </a>
          </li>
        </ul>
      </div>
    </nav>
  )
}
