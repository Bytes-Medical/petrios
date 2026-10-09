import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import s from './hud.module.css'

/**
 * The HUD panel: 1px edge, 4px clay top rule (or none), surface fill and an
 * 8px solid offset shadow. `footer` renders full-bleed under a 1px edge,
 * which is where SpecStrips go.
 */
export function Panel({
  as: Tag = 'section',
  rule = 'clay',
  pad = 'md',
  footer,
  id,
  className,
  bodyClassName,
  children,
  'aria-labelledby': labelledBy,
  'aria-label': label,
}: {
  as?: 'section' | 'article' | 'div'
  rule?: 'clay' | 'none'
  pad?: 'md' | 'none'
  footer?: ReactNode
  id?: string
  className?: string
  bodyClassName?: string
  children?: ReactNode
  'aria-labelledby'?: string
  'aria-label'?: string
}) {
  return (
    <Tag
      id={id}
      aria-labelledby={labelledBy}
      aria-label={label}
      className={clsx(s.panel, rule === 'none' && s.panelPlain, className)}
    >
      {pad === 'md' ? <div className={clsx(s.panelBody, bodyClassName)}>{children}</div> : children}
      {footer ? <div className={s.panelFooter}>{footer}</div> : null}
    </Tag>
  )
}

/**
 * Panel heading with its label inside the h2, so heading navigation reads
 * "Attendance: Evidence, not box-ticking".
 */
export function PanelTitle({
  id,
  label,
  as: Tag = 'h2',
  className,
  children,
}: {
  id?: string
  label?: string
  as?: 'h2' | 'h3'
  className?: string
  children: ReactNode
}) {
  return (
    <Tag id={id} className={clsx(s.panelTitle, className)}>
      {label ? (
        <>
          <span className={s.panelLabel}>{label}</span>
          <span className={s.srOnly}>: </span>
        </>
      ) : null}
      {children}
    </Tag>
  )
}
