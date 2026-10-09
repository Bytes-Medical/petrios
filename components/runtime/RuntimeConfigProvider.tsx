'use client'

import { createContext, useContext } from 'react'
import type { PublicRuntimeConfig } from '@/lib/runtime-config'

const RuntimeConfigContext = createContext<PublicRuntimeConfig | null>(null)

export function RuntimeConfigProvider({ config, children }: { config: PublicRuntimeConfig; children: React.ReactNode }) {
  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>
}

export function useRuntimeConfig() {
  const config = useContext(RuntimeConfigContext)
  if (!config) throw new Error('RuntimeConfigProvider is required')
  return config
}
