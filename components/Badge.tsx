import { HTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Status chip in the house style: mono uppercase, hard border, no radius.
const badgeVariants = cva(
  'inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'border-black bg-white text-black',
        ink: 'border-black bg-black text-white',
        clay: 'border-clay-600 bg-clay-600 text-white',
        success: 'border-green-700 bg-green-50 text-green-800',
        warning: 'border-amber-600 bg-amber-50 text-amber-800',
        danger: 'border-red-700 bg-red-50 text-red-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
)
Badge.displayName = 'Badge'

export { Badge, badgeVariants }
