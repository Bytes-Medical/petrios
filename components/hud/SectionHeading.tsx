import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

/** Centred landing-section h2 with an optional lede; owns the 24px gap below. */
export function SectionHeading({
  id,
  title,
  lede,
  className,
}: {
  id?: string
  title: ReactNode
  lede?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx(s.sectionHeading, className)}>
      <h2 id={id} className={s.sectionTitle}>
        {title}
      </h2>
      {lede ? <p className={s.sectionLede}>{lede}</p> : null}
    </div>
  )
}
