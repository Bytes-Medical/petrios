import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { clsx } from 'clsx'
import { Footer } from '@/components/Footer'
import { PublicNav, type PublicNavKey } from '@/components/PublicNav'
import { DISPLAY_COOKIE, parseDisplay } from '@/lib/public-display'
import s from './hud.module.css'

/**
 * Root of every public page and the scope boundary of the Clinical HUD:
 * the --hud-* tokens exist only under this element, so the signed-in app is
 * unaffected. Display mode is read from the petrios-display cookie on the
 * server, so every SSR and RSC render is right without an inline script.
 */
export async function HudShell({
  current,
  width = 'page',
  children,
}: {
  current?: PublicNavKey
  width?: 'page' | 'prose'
  children: ReactNode
}) {
  const display = parseDisplay((await cookies()).get(DISPLAY_COOKIE)?.value)
  return (
    <div data-hud-root="" data-display={display} className={s.hud}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <PublicNav current={current} />
      <main id="main" className={s.main} tabIndex={-1}>
        <div className={clsx(s.column, width === 'prose' && s.columnProse)}>{children}</div>
      </main>
      <Footer display={display} />
    </div>
  )
}
