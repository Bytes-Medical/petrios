import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

export type StatusKind = 'info' | 'ok' | 'off' | 'attention' | 'pending' | 'live'

const KIND: Record<StatusKind, { className: string; glyph: string | null }> = {
  info: { className: s.chipInfo, glyph: null },
  ok: { className: s.chipOk, glyph: '●' },
  off: { className: s.chipOff, glyph: '○' },
  attention: { className: s.chipAttention, glyph: '▲' },
  pending: { className: s.chipPending, glyph: '◌' },
  live: { className: s.chipLive, glyph: '●' },
}

/**
 * Status by shape and words, never colour alone (IEC 60601-1-8 practice,
 * spec/07). The glyph is aria-hidden; the text always carries the state.
 */
export function StatusChip({
  kind,
  wrap = false,
  className,
  children,
}: {
  kind: StatusKind
  wrap?: boolean
  className?: string
  children: ReactNode
}) {
  const { className: kindClass, glyph } = KIND[kind]
  return (
    <span className={clsx(s.chip, kindClass, wrap && s.chipWrap, className)}>
      {glyph ? (
        <span className={s.chipGlyph} aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {children}
    </span>
  )
}
