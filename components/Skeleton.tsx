import { cn } from '@/lib/utils'

/**
 * Loading-state primitives for route-level loading.tsx files (and any
 * client fallback). Server-safe, no data fetching — loading files render
 * before data exists by definition. House style: bordered card shapes with
 * pulsing gray blocks in place of content.
 */

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-gray-200', className)} aria-hidden="true" />
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="border border-black bg-white p-6" aria-hidden="true">
      <SkeletonBlock className="mb-4 h-5 w-40" />
      <div className="space-y-3">
        {Array.from({ length: lines }, (_, i) => (
          <SkeletonBlock key={i} className={i % 2 ? 'h-4 w-3/4' : 'h-4 w-full'} />
        ))}
      </div>
    </div>
  )
}

/** Static stand-in for NavShell (which fetches; loading files must not). */
export function SkeletonNav() {
  return (
    <nav className="border-b border-black bg-white" aria-hidden="true">
      <div className="mx-auto flex h-[57px] max-w-7xl items-center justify-between px-4 sm:px-6">
        <SkeletonBlock className="h-6 w-32" />
        <SkeletonBlock className="h-6 w-64" />
      </div>
    </nav>
  )
}

/** Whole-page skeleton: nav bar + title + stacked cards. */
export function SkeletonPage({ cards = 3 }: { cards?: number }) {
  return (
    <div className="min-h-screen">
      <SkeletonNav />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <SkeletonBlock className="mb-2 h-8 w-64" />
        <SkeletonBlock className="mb-6 h-4 w-40 sm:mb-8" />
        <div className="space-y-6">
          {Array.from({ length: cards }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
