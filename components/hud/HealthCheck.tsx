'use client'

import { useState, useSyncExternalStore } from 'react'
import { clsx } from 'clsx'
import { classifyHealthResponse, type HealthOutcome } from '@/lib/health-check'
import { hudLink } from '@/components/hud/HudLink'
import { StatusChip, type StatusKind } from './StatusChip'
import s from './hud.module.css'

type CheckState = 'idle' | 'checking' | HealthOutcome

const CHIP: Record<CheckState, { kind: StatusKind; text: string }> = {
  idle: { kind: 'off', text: 'Not checked' },
  checking: { kind: 'pending', text: 'Checking…' },
  up: { kind: 'live', text: 'This instance is up, database reachable' },
  degraded: { kind: 'attention', text: 'This instance is up, database unreachable' },
  'no-response': { kind: 'off', text: 'No response from this instance' },
}

const TIMEOUT_MS = 10_000

const noopSubscribe = () => () => {}

/**
 * A monitor-style self-test of this instance's /api/health. It runs only
 * when someone presses the button (no request on page view, no polling), so
 * it never pings the database per visit. Same-origin, so CSP connect-src
 * 'self' covers it. Inert until hydrated.
 */
export function HealthCheck({ className }: { className?: string }) {
  const [state, setState] = useState<CheckState>('idle')
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const checking = state === 'checking'

  async function run() {
    if (checking) return
    setState('checking')
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal })
      setState(classifyHealthResponse(response.status, await response.json()))
    } catch {
      setState('no-response')
    } finally {
      window.clearTimeout(timer)
    }
  }

  const chip = CHIP[state]
  return (
    <div className={clsx(s.health, className)}>
      <button
        type="button"
        className={hudLink({ variant: 'secondary', size: 'sm' })}
        onClick={run}
        // aria-disabled, not disabled, while checking: disabling the focused
        // button would drop keyboard focus to <body> and never restore it.
        disabled={!hydrated}
        aria-disabled={checking || undefined}
      >
        Run health check
      </button>
      <span role="status" aria-live="polite">
        <StatusChip kind={chip.kind} wrap>
          {chip.text}
        </StatusChip>
      </span>
    </div>
  )
}
