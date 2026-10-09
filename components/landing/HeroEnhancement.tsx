'use client'

import { useEffect, useRef } from 'react'
import styles from '@/app/landing.module.css'

/** The server-rendered diagram remains the complete fallback, including labels. */
export function HeroEnhancement() {
  const mount = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = mount.current
    const diagram = element?.parentElement
    if (!element || !diagram) return

    const eligibility = window.matchMedia(
      '(min-width: 1024px) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
    )
    const connection = (
      navigator as Navigator & {
        connection?: EventTarget & { saveData?: boolean }
      }
    ).connection
    let disposed = false
    let visible = false
    let generation = 0
    let pending = false
    let failed = false
    let release: (() => void) | undefined
    let idle: number | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined

    function stop() {
      generation++
      pending = false
      if (idle !== undefined) window.cancelIdleCallback(idle)
      if (fallbackTimer !== undefined) clearTimeout(fallbackTimer)
      idle = undefined
      fallbackTimer = undefined
      release?.()
      release = undefined
    }

    function update() {
      if (disposed) return
      if (
        !eligibility.matches ||
        connection?.saveData ||
        !visible ||
        document.hidden
      ) {
        stop()
        return
      }
      if (release || pending || failed) return
      pending = true
      const current = ++generation
      const load = async () => {
        try {
          // Kept behind eligibility and idle time: ineligible visitors never fetch Three.js.
          const { createWorkflowScene } = await import('./workflow-scene')
          if (disposed || current !== generation) return
          release = createWorkflowScene(element!, diagram!)
        } catch {
          // A failed import, blocked GPU, or lost context must not interrupt the page.
          if (current === generation) failed = true
        } finally {
          if (current === generation) pending = false
        }
      }
      if ('requestIdleCallback' in window)
        idle = window.requestIdleCallback(() => void load(), { timeout: 1500 })
      else fallbackTimer = setTimeout(() => void load(), 200)
    }

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      update()
    })
    observer.observe(diagram)
    eligibility.addEventListener('change', update)
    connection?.addEventListener('change', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      disposed = true
      stop()
      observer.disconnect()
      eligibility.removeEventListener('change', update)
      connection?.removeEventListener('change', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return <div ref={mount} className={styles.scene} aria-hidden="true" />
}
