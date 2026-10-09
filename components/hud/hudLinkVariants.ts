import { cva, type VariantProps } from 'class-variance-authority'
import s from './hud.module.css'

/**
 * CTA styling for links (and the health-check button). The public-site
 * counterpart of buttonVariants, which stays untouched for the app. Import
 * it from '@/components/hud/HudLink': a sibling file named hudLink.ts would
 * differ from HudLink.tsx only by case and resolve to the wrong module on
 * case-insensitive file systems.
 */
export const hudLink = cva(s.hudLink, {
  variants: {
    variant: { primary: s.primary, secondary: s.secondary, ink: s.ink },
    size: { md: s.md, sm: s.sm },
    block: { true: s.block, false: null },
  },
  defaultVariants: { variant: 'primary', size: 'md', block: false },
})

export type HudLinkVariants = VariantProps<typeof hudLink>

/** Underlined inline text link. */
export const hudTextLink = s.textLink
