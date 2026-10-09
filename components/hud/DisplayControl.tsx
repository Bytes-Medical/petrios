'use client'

import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  DISPLAY_OPTIONS,
  displayCookie,
  displayFromCookieString,
  type Display,
} from '@/lib/public-display'
import s from './hud.module.css'

// The cookie is the client's source of truth; HudShell renders the same value
// on the server. Listeners re-read it after a choice and on a bfcache restore.
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) listener()
  }
  listeners.add(listener)
  window.addEventListener('pageshow', onPageShow)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('pageshow', onPageShow)
  }
}

const readCookie = () => displayFromCookieString(document.cookie)
const noopSubscribe = () => () => {}

function storeDisplay(next: Display) {
  document.cookie = displayCookie(next, window.location.protocol === 'https:')
  listeners.forEach((listener) => listener())
}

/**
 * Day / Night / Match device, in the public footer. Inert (disabled) until
 * hydrated, so without JavaScript it honestly does nothing.
 */
export function DisplayControl({ display, className }: { display: Display; className?: string }) {
  const router = useRouter()
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const value = useSyncExternalStore(subscribe, readCookie, () => display)
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  // Reconcile the root with the cookie before every paint: a stale RSC payload
  // from the client router cache, or a bfcache restore, can carry an old mode.
  useLayoutEffect(() => {
    const root = fieldset.current?.closest('[data-hud-root]')
    if (root && root.getAttribute('data-display') !== value) root.setAttribute('data-display', value)
  })

  function choose(next: Display) {
    fieldset.current?.closest('[data-hud-root]')?.setAttribute('data-display', next)
    storeDisplay(next)
    router.refresh()
  }

  return (
    <fieldset ref={fieldset} className={clsx(s.display, className)} disabled={!hydrated}>
      <legend className={s.caption}>Display</legend>
      <div className={s.segmented}>
        {DISPLAY_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="hud-display"
              value={option.value}
              checked={value === option.value}
              onChange={() => choose(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p className={clsx(s.caption, s.displayNote)}>Night and Match device are remembered with a cookie.</p>
    </fieldset>
  )
}
