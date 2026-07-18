import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Neo-brutalist button: hard ink shadow that compresses flat on press, so
// every click reads as a physical push. Keep new variants inside this system.
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 border font-mono whitespace-nowrap transition-[background-color,border-color,box-shadow,transform] shadow-[3px_3px_0_#1F1D1A] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:translate-x-0 disabled:active:translate-y-0',
  {
    variants: {
      variant: {
        primary:
          'border-clay-600 bg-clay-600 text-white hover:bg-clay-700 hover:border-clay-700',
        secondary: 'border-black bg-white text-black hover:bg-gray-50',
        danger:
          'border-red-700 bg-white text-red-700 hover:bg-red-700 hover:text-white',
        ghost:
          'border-transparent bg-transparent text-black shadow-none active:translate-x-0 active:translate-y-0 hover:bg-gray-100',
      },
      size: {
        sm: 'px-3 py-1 text-xs',
        default: 'px-4 py-2 text-sm',
        lg: 'px-6 py-3 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** In-flight state: disables the button, sets aria-busy, prepends a
   *  spinner. Keep it true until the UI reflects the completed work (see
   *  hooks/useActionWithRefresh). */
  pending?: boolean
}

const spinnerSize = { sm: 'h-3 w-3', default: 'h-3.5 w-3.5', lg: 'h-4 w-4' } as const

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, pending, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
        <svg
          className={cn('animate-spin', spinnerSize[size ?? 'default'])}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
      ) : null}
      {children}
    </button>
  )
)
Button.displayName = 'Button'

export { Button, buttonVariants }
