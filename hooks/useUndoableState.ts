import { useCallback, useRef, useState } from 'react'

interface History<T> {
  past: T[]
  present: T
  future: T[]
}

const MAX_HISTORY = 100

export interface UndoableState<T> {
  state: T
  /**
   * Update the state. Pass a `coalesceKey` for continuous edits (dragging a
   * slider, typing in a field): consecutive sets with the same key collapse
   * into ONE undo entry until `coalesceMs` of idleness passes or `commit()` is
   * called. Omit the key for discrete actions (add/delete/duplicate) so each is
   * its own undo step.
   */
  set: (updater: T | ((prev: T) => T), coalesceKey?: string) => void
  /** Force the next set to begin a fresh history entry. */
  commit: () => void
  undo: () => void
  redo: () => void
  /** Replace state and clear history (e.g. loading a different deck). */
  reset: (state: T) => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Generic undo/redo store for a single value. Used to make the slide deck
 * undoable in the editor. Coalescing keeps rapid edits from flooding history.
 */
export function useUndoableState<T>(
  initial: T,
  options?: { coalesceMs?: number }
): UndoableState<T> {
  const coalesceMs = options?.coalesceMs ?? 500
  const [hist, setHist] = useState<History<T>>({ past: [], present: initial, future: [] })
  const pendingKey = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPending = useCallback(() => {
    pendingKey.current = null
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const commit = useCallback(() => clearPending(), [clearPending])

  const set = useCallback(
    (updater: T | ((prev: T) => T), coalesceKey?: string) => {
      setHist((h) => {
        const next =
          typeof updater === 'function' ? (updater as (p: T) => T)(h.present) : updater
        const coalescing = coalesceKey != null && coalesceKey === pendingKey.current
        if (coalescing) {
          return { past: h.past, present: next, future: [] }
        }
        const past = [...h.past, h.present]
        if (past.length > MAX_HISTORY) past.shift()
        return { past, present: next, future: [] }
      })

      if (coalesceKey != null) {
        pendingKey.current = coalesceKey
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          pendingKey.current = null
          timer.current = null
        }, coalesceMs)
      } else {
        clearPending()
      }
    },
    [coalesceMs, clearPending]
  )

  const undo = useCallback(() => {
    clearPending()
    setHist((h) =>
      h.past.length === 0
        ? h
        : {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future],
          }
    )
  }, [clearPending])

  const redo = useCallback(() => {
    clearPending()
    setHist((h) =>
      h.future.length === 0
        ? h
        : {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
    )
  }, [clearPending])

  const reset = useCallback(
    (state: T) => {
      clearPending()
      setHist({ past: [], present: state, future: [] })
    },
    [clearPending]
  )

  return {
    state: hist.present,
    set,
    commit,
    undo,
    redo,
    reset,
    canUndo: hist.past.length > 0,
    canRedo: hist.future.length > 0,
  }
}
