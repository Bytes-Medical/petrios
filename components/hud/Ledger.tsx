import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { Panel } from './Panel'
import { Readout } from './Readout'
import { StatusChip } from './StatusChip'
import s from './hud.module.css'

export interface LedgerPerson {
  name: string
  detail: string
  url?: string
}

/**
 * The /contributors ledger: a header with the computed head count and the
 * GitHub list's state, one row per person (a list, not a sequence, so no
 * row numbers), and a wash footer strip. A linked row is one full-row link
 * whose ↗ is aria-hidden.
 */
export function Ledger({
  title,
  people,
  githubList,
  footer,
  className,
}: {
  title: string
  people: ReadonlyArray<LedgerPerson>
  githubList: 'cached' | 'unavailable'
  footer: ReactNode
  className?: string
}) {
  return (
    <Panel as="section" pad="none" aria-labelledby="ledger-title" className={className}>
      <div className={s.ledgerHead}>
        <h2 id="ledger-title" className={s.panelTitle}>
          {title}
        </h2>
        <div className={s.ledgerMeta}>
          <Readout
            layout="row"
            label="People listed"
            value={people.length}
            source="Computed: curated contributors plus de-duplicated GitHub contributors"
          />
          {githubList === 'cached' ? (
            <StatusChip kind="ok" wrap>
              GitHub list, cached up to 1 hour
            </StatusChip>
          ) : (
            <StatusChip kind="attention" wrap>
              GitHub list unavailable
            </StatusChip>
          )}
        </div>
      </div>
      <ul className={s.ledgerList}>
        {people.map((person) => {
          const content = (
            <>
              <span className="min-w-0 break-words">
                <span className={s.ledgerName}>{person.name}</span>
                <span className={s.ledgerDetail}>{person.detail}</span>
              </span>
              {person.url ? (
                <span aria-hidden="true" className={s.ledgerArrow}>
                  ↗
                </span>
              ) : null}
            </>
          )
          return (
            <li key={`${person.name}-${person.detail}`}>
              {person.url ? (
                <a href={person.url} className={clsx(s.ledgerRow, s.ledgerLink)}>
                  {content}
                </a>
              ) : (
                <div className={s.ledgerRow}>{content}</div>
              )}
            </li>
          )
        })}
      </ul>
      <p className={s.ledgerFoot}>{footer}</p>
    </Panel>
  )
}
