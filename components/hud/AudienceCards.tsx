import { clsx } from 'clsx'
import s from './hud.module.css'

export interface Audience {
  /** One letter in the clay square; decorative, echoing the calibration ■. */
  initial: string
  title: string
  lead: string
  body: string
}

/** Who the product is for. Not a sequence, so not numbered. */
export function AudienceCards({ items, className }: { items: ReadonlyArray<Audience>; className?: string }) {
  return (
    <ul className={clsx(s.audiences, className)}>
      {items.map((item) => (
        <li key={item.title} className={s.audience}>
          <span className={s.initial} aria-hidden="true">
            {item.initial}
          </span>
          <h3 className={s.cardTitle}>{item.title}</h3>
          <p className={s.lead}>{item.lead}</p>
          <p className={s.cardBody}>{item.body}</p>
        </li>
      ))}
    </ul>
  )
}
