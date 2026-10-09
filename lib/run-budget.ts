/**
 * Per-run work cap for cron jobs. On Workers a scheduled invocation gets
 * 10,000 subrequests by default and a 15-minute wall-clock cap. A job reserves
 * the estimated subrequest cost of each step before starting it, and stops
 * starting work once the unit budget or the time budget is used up. Work it
 * did not reach stays in the per-recipient ledger for the next run.
 *
 * Exhaustion is sticky: after the first refusal every later `take` also
 * refuses, so a cheaper step cannot run ahead of a deferred one.
 */
export interface RunBudget {
  take(cost: number): boolean
  readonly exhausted: boolean
  /** Units still available to reserve; 0 once exhausted. Only `take` checks the time budget. */
  readonly remaining: number
}

/** Estimated subrequests per run, leaving headroom under the Workers default of 10,000. */
export const CRON_SUBREQUEST_BUDGET = 8_000

/** Stop starting new work well before the 15-minute Cron Trigger wall cap. */
export const CRON_TIME_BUDGET_MS = 10 * 60 * 1000

export function createRunBudget(options: {
  maxUnits: number
  maxDurationMs: number
  now?: () => number
}): RunBudget {
  const now = options.now ?? Date.now
  const deadline = now() + options.maxDurationMs
  let used = 0
  let exhausted = false

  return {
    take(cost: number): boolean {
      if (exhausted) return false
      if (used + cost > options.maxUnits || now() >= deadline) {
        exhausted = true
        return false
      }
      used += cost
      return true
    },
    get exhausted() {
      return exhausted
    },
    get remaining() {
      return exhausted ? 0 : options.maxUnits - used
    },
  }
}

/**
 * A slice of `parent` capped at `maxUnits`, so one unit of work (for example
 * one session) cannot spend what later units of the same run need. Reaching
 * the cap exhausts only the slice, stickily, and leaves the parent usable. The
 * parent running out of units or time exhausts every slice.
 */
export function createBudgetSlice(parent: RunBudget, maxUnits: number): RunBudget {
  let used = 0
  let exhausted = false

  return {
    take(cost: number): boolean {
      if (exhausted) return false
      if (used + cost > maxUnits || !parent.take(cost)) {
        exhausted = true
        return false
      }
      used += cost
      return true
    },
    get exhausted() {
      return exhausted || parent.exhausted
    },
    get remaining() {
      if (exhausted || parent.exhausted) return 0
      return Math.max(0, Math.min(maxUnits - used, parent.remaining))
    },
  }
}
