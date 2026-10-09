import { clsx } from 'clsx'
import s from './hud.module.css'

/**
 * Public-site wordmark: visually the shared Wordmark, but driven by the HUD
 * tokens so it holds up in Night. components/Wordmark.tsx stays untouched
 * for the signed-in app.
 */
export function HudWordmark({ size = 'sm', className }: { size?: 'sm' | 'lg'; className?: string }) {
  return (
    <span className={clsx(s.wordmark, size === 'lg' && s.wordmarkLg, className)}>
      <span aria-hidden="true" className={s.wordmarkBlock} />
      PETRIOS
    </span>
  )
}
