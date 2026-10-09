import type { AnchorHTMLAttributes, ReactNode } from 'react'
import Link from 'next/link'
import { clsx } from 'clsx'
import { hudLink, hudTextLink } from './hudLinkVariants'

export { hudLink, hudTextLink, type HudLinkVariants } from './hudLinkVariants'

export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/**
 * A link styled as a HUD CTA (`variant` primary / secondary / ink) or as an
 * inline text link (`variant="text"`, the default). Internal hrefs use
 * next/link. External ones are plain anchors with an aria-hidden ↗, so
 * accessible names never include arrows; `external` defaults to whether the
 * href is an absolute http(s) URL.
 */
export function HudLink({
  href,
  external = isExternalHref(href),
  variant = 'text',
  size,
  block,
  className,
  children,
  ...rest
}: {
  href: string
  external?: boolean
  variant?: 'text' | 'primary' | 'secondary' | 'ink'
  size?: 'md' | 'sm'
  block?: boolean
  className?: string
  children: ReactNode
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className' | 'children'>) {
  const classes =
    variant === 'text' ? clsx(hudTextLink, className) : hudLink({ variant, size, block, className })
  if (external) {
    return (
      <a href={href} className={classes} {...rest}>
        {children}
        <span aria-hidden="true">{' ↗'}</span>
      </a>
    )
  }
  return (
    <Link href={href} className={classes} {...rest}>
      {children}
    </Link>
  )
}
