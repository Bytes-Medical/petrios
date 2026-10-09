import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

export interface PageHeaderFact {
  label: string
  value: ReactNode
}

/**
 * Centred inner-page header: the page h1, a lede, and optional facts (the
 * legal pages' deployment address and last-updated date). It sits on the
 * dot grid, so the small text is backed. Spacing below is placement: set it
 * with a utility.
 */
export function PageHeader({
  title,
  lede,
  facts,
  id,
  className,
}: {
  title: ReactNode
  lede?: ReactNode
  facts?: ReadonlyArray<PageHeaderFact>
  id?: string
  className?: string
}) {
  return (
    <header className={clsx(s.pageHeader, className)}>
      <h1 id={id} className={s.pageTitle}>
        {title}
      </h1>
      {lede ? (
        <p className={s.pageLede}>
          <span className={s.backed}>{lede}</span>
        </p>
      ) : null}
      {facts && facts.length > 0 ? (
        <dl className={s.headerFacts}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  )
}
