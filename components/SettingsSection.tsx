import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Collapsible settings card: a native <details> disclosure styled like Card,
 * so dense management pages read as a compact list of section headers
 * instead of one long scroll. Server-renderable (no client JS — the browser
 * owns the toggle). Long content should pass `scroll` so the section body
 * scrolls internally instead of stretching the page.
 */
export function SettingsSection({
  title,
  description,
  count,
  defaultOpen = false,
  scroll = false,
  children,
}: {
  title: string
  description?: string
  /** Shown as "(n)" after the title so a collapsed section still informs. */
  count?: number
  defaultOpen?: boolean
  /** Cap the body height and scroll inside it. */
  scroll?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group border border-black bg-white">
      <summary className="flex cursor-pointer select-none items-start justify-between gap-3 px-4 py-4 hover:bg-gray-50 sm:px-6 focus-visible:outline focus-visible:outline-2 focus-visible:outline-clay-600">
        <span>
          <span className="block font-mono text-lg font-bold">
            {title}
            {count !== undefined ? (
              <span className="text-gray-500"> ({count})</span>
            ) : null}
          </span>
          {description ? (
            <span className="mt-1 block font-mono text-xs leading-5 text-gray-600">
              {description}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className="mt-1 shrink-0 font-mono text-sm transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div
        className={cn(
          'border-t border-black px-4 py-5 sm:px-6',
          scroll && 'max-h-[28rem] overflow-y-auto'
        )}
      >
        {children}
      </div>
    </details>
  )
}
