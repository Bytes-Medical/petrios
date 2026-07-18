'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type { SessionCalendar } from './SessionCalendar'

/**
 * Code-split wrapper for SessionCalendar: Schedule-X, its CSS, and the
 * temporal polyfill are heavy and client-only, so they load as their own
 * chunk after the page paints instead of blocking the dashboard bundle.
 * Same pattern as JitsiMeetingPanel (ssr:false needs a client wrapper).
 */
const LazyCalendar = dynamic(
  () => import('./SessionCalendar').then((m) => m.SessionCalendar),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[560px] animate-pulse border border-black bg-gray-100"
        aria-hidden="true"
      />
    ),
  }
)

export function SessionCalendarLazy(props: ComponentProps<typeof SessionCalendar>) {
  return <LazyCalendar {...props} />
}
