import { cn } from '@/lib/utils'

/**
 * The Petrios wordmark — the logo is deliberately just type: IBM Plex Mono
 * bold with a clay block, matching the design system everywhere it appears
 * (nav, hero, auth cards). Server-safe.
 */
export function Wordmark({
  size = 'sm',
  className,
}: {
  size?: 'sm' | 'lg'
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-2 font-mono font-bold tracking-tight text-black',
        size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-lg sm:text-xl',
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block shrink-0 self-center bg-clay-600',
          size === 'lg' ? 'h-6 w-6 sm:h-7 sm:w-7' : 'h-3 w-3 sm:h-3.5 sm:w-3.5'
        )}
      />
      PETRIOS
    </span>
  )
}
