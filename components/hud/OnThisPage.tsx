import { clsx } from 'clsx'
import { complianceSectionId } from '@/lib/compliance-sections'
import s from './hud.module.css'

export type OnThisPageSection = string | { readonly id: string; readonly label: string }

/**
 * In-page contents built from an explicit SECTIONS constant, never from
 * React children. A string entry is a compliance-section title and links to
 * complianceSectionId(title); otherwise pass `{ id, label }`.
 * `chips` sits on the page ground (/features); `rail` sits beside legal prose
 * and is sticky from 1024px, unless CompliancePage stacks it above the body.
 */
export function OnThisPage({
  sections,
  variant,
  className,
}: {
  sections: ReadonlyArray<OnThisPageSection>
  variant: 'chips' | 'rail'
  className?: string
}) {
  const items = sections.map((section) =>
    typeof section === 'string' ? { id: complianceSectionId(section), label: section } : section
  )
  return (
    <nav aria-label="On this page" className={clsx(s.toc, variant === 'chips' ? s.tocChips : s.tocRail, className)}>
      <p className={s.caption}>{variant === 'chips' ? <span className={s.backed}>On this page</span> : 'On this page'}</p>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
