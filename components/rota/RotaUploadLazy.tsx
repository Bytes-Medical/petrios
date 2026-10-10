'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type { RotaUploadWizard } from './RotaUploadWizard'

/**
 * Code-split wrapper for the rota upload wizard (CSV parsing, mapping and
 * payload building all run in the browser), following SessionCalendarLazy.
 */
const LazyWizard = dynamic(() => import('./RotaUploadWizard').then((m) => m.RotaUploadWizard), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse border border-black bg-gray-100" aria-hidden="true" />,
})

export function RotaUploadLazy(props: ComponentProps<typeof RotaUploadWizard>) {
  return <LazyWizard {...props} />
}
