import { clsx } from 'clsx'
import { Readout, type ReadoutProps } from './Readout'
import s from './hud.module.css'

export interface SequenceStep {
  title: string
  body: string
  /** A verified product fact for this step; `source` names where it comes from. */
  readout: Omit<ReadoutProps, 'className' | 'layout'>
}

/**
 * The landing page's one real sequence. The visible 01/02/03 is derived from
 * the position, so it can never disagree with the list order.
 */
export function SequenceSteps({ items, className }: { items: ReadonlyArray<SequenceStep>; className?: string }) {
  return (
    // role="list" because WebKit drops list semantics (and the step count)
    // from list-style:none lists, and the visible numbers are aria-hidden.
    <ol role="list" className={clsx(s.steps, className)}>
      {items.map((item, index) => (
        <li key={item.title} className={s.step}>
          <div className={s.stepBody}>
            <span className={s.stepN} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className={s.cardTitle}>{item.title}</h3>
            <p className={s.stepText}>{item.body}</p>
          </div>
          <Readout {...item.readout} className={s.stepReadout} />
        </li>
      ))}
    </ol>
  )
}
