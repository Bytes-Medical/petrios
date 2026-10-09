import type { CSSProperties, ReactNode } from 'react'
import { clsx } from 'clsx'
import { HudShell } from '@/components/hud/HudShell'
import { OnThisPage } from '@/components/hud/OnThisPage'
import { PageHeader, type PageHeaderFact } from '@/components/hud/PageHeader'
import { Panel } from '@/components/hud/Panel'
import s from '@/components/hud/hud.module.css'
import { complianceSectionId } from '@/lib/compliance-sections'
import { formatNewsDate } from '@/lib/news-data'
import { getPublicRuntimeConfig } from '@/lib/runtime-config'

/** ISO day of the last material change; the privacy notice promises to move it. */
export const COMPLIANCE_LAST_UPDATED = '2026-10-09'

const TITLE_ID = 'page-title'

/** Host of the configured public URL (not the request host); null when it cannot be parsed. */
function deploymentAddress(): string | null {
  try {
    return new URL(getPublicRuntimeConfig().appUrl).host || null
  } catch {
    return null
  }
}

/** `wide` lifts the 68ch measure for tables and figures; paragraphs and lists keep it. */
export function ComplianceSection({
  title,
  wide = false,
  children,
}: {
  title: string
  wide?: boolean
  children: ReactNode
}) {
  const id = complianceSectionId(title)
  return (
    <section aria-labelledby={id} className={s.legalSection}>
      <h2 id={id} className={s.legalTitle}>
        {title}
      </h2>
      <div className={clsx(s.prose, wide && s.proseWide)}>{children}</div>
    </section>
  )
}

export interface Fact {
  label: string
  value: ReactNode
}

/** Labelled deployment facts. `dtWidth` sets the label column from 640px. */
export function FactList({
  items,
  dtWidth,
  className,
}: {
  items: ReadonlyArray<Fact>
  dtWidth?: string
  className?: string
}) {
  return (
    <dl
      className={clsx(s.factList, className)}
      style={dtWidth ? ({ '--dt': dtWidth } as CSSProperties) : undefined}
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

/** A required deployment fact the operator has not declared. The wording is fixed by spec/13. */
export function MissingDisclosure({ children }: { children: ReactNode }) {
  return (
    <span className={s.missing}>
      <span aria-hidden="true">
        <svg className={s.missingMark} viewBox="0 0 10 10" focusable="false">
          <path d="M0 10 5 0l5 10Z" />
        </svg>{' '}
      </span>
      Not declared by this deployment: {children}
    </span>
  )
}

/**
 * `contents="stacked"` keeps the contents list above the body at every width,
 * giving the body the panel's full width (the /subprocessors register).
 */
export function CompliancePage({
  title,
  description,
  sections,
  contents = 'rail',
  children,
}: {
  title: string
  description: string
  sections: ReadonlyArray<string>
  contents?: 'rail' | 'stacked'
  children: ReactNode
}) {
  const host = deploymentAddress()
  const facts: PageHeaderFact[] = [
    ...(host ? [{ label: 'Deployment address', value: host }] : []),
    {
      label: 'Last updated',
      value: <time dateTime={COMPLIANCE_LAST_UPDATED}>{formatNewsDate(COMPLIANCE_LAST_UPDATED)}</time>,
    },
  ]

  return (
    <HudShell width="page">
      <PageHeader id={TITLE_ID} title={title} lede={description} facts={facts} />
      <Panel
        as="article"
        aria-labelledby={TITLE_ID}
        bodyClassName={clsx(s.legalGrid, contents === 'stacked' && s.legalGridStacked)}
      >
        <OnThisPage variant="rail" sections={sections} />
        <div>{children}</div>
      </Panel>
    </HudShell>
  )
}
