import type { CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

const NUMERIC = /^-?\d+(?:[.,]\d+)?$/

export interface ReadoutProps {
  label: string
  value: string | number
  unit?: string
  /** Spec section or code constant this fact comes from. Never rendered. */
  source: string
  layout?: 'stack' | 'row'
  className?: string
}

/**
 * Monitor-style parameter tile: caption label, large value, small unit.
 * A non-numeric value renders as the text variant. `source` names the spec
 * section or code constant the value comes from; it is for reviewers and is
 * never rendered, because readouts show verified product facts only.
 */
export function Readout({ label, value, unit, layout = 'stack', className }: ReadoutProps) {
  const numeric = typeof value === 'number' || NUMERIC.test(value)
  return (
    <dl className={clsx(s.readout, layout === 'row' && s.readoutRow, className)}>
      <div>
        <dt>{label}</dt>
        {numeric ? (
          <dd>
            <span className={s.readoutValue}>{value}</span>
            {unit ? <span className={s.readoutUnit}>{unit}</span> : null}
          </dd>
        ) : (
          <dd className={s.readoutRowText}>
            <span className={s.readoutText}>{value}</span>
          </dd>
        )}
      </div>
    </dl>
  )
}

export interface SpecItem {
  label: string
  value: ReactNode
  /** Spec section or code constant this fact comes from. Never rendered. */
  source: string
}

/**
 * A strip of two or three verified product facts. Full-bleed inside a
 * Panel footer; `framed` gives it its own edge when it stands alone.
 */
export function SpecStrip({
  items,
  framed = false,
  className,
}: {
  items: ReadonlyArray<SpecItem>
  framed?: boolean
  className?: string
}) {
  return (
    <dl
      className={clsx(s.spec, framed && s.specFramed, className)}
      style={{ '--cols': items.length } as CSSProperties}
    >
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
