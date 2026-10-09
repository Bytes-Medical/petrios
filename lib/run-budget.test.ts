import { describe, expect, it } from 'vitest'
import {
  CRON_SUBREQUEST_BUDGET,
  CRON_TIME_BUDGET_MS,
  createBudgetSlice,
  createRunBudget,
} from './run-budget'

function clock(start = 0) {
  let now = start
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

describe('createRunBudget', () => {
  it('grants work until the unit budget would be exceeded', () => {
    const time = clock()
    const budget = createRunBudget({ maxUnits: 10, maxDurationMs: 1_000, now: time.now })
    expect(budget.take(4)).toBe(true)
    expect(budget.take(6)).toBe(true)
    expect(budget.exhausted).toBe(false)
    expect(budget.take(1)).toBe(false)
    expect(budget.exhausted).toBe(true)
  })

  it('stays exhausted so a cheaper step cannot run after a deferred one', () => {
    const budget = createRunBudget({ maxUnits: 10, maxDurationMs: 1_000, now: clock().now })
    expect(budget.take(8)).toBe(true)
    expect(budget.take(5)).toBe(false)
    expect(budget.take(1)).toBe(false)
  })

  it('refuses work once the time budget has elapsed', () => {
    const time = clock(1_000)
    const budget = createRunBudget({ maxUnits: 100, maxDurationMs: 500, now: time.now })
    expect(budget.take(1)).toBe(true)
    time.advance(499)
    expect(budget.take(1)).toBe(true)
    time.advance(1)
    expect(budget.take(1)).toBe(false)
    expect(budget.exhausted).toBe(true)
  })

  it('reports the units still available, and none once exhausted', () => {
    const budget = createRunBudget({ maxUnits: 10, maxDurationMs: 1_000, now: clock().now })
    expect(budget.remaining).toBe(10)
    budget.take(4)
    expect(budget.remaining).toBe(6)
    budget.take(7)
    expect(budget.remaining).toBe(0)
  })

  it('keeps cron runs under the Workers subrequest and wall-clock caps', () => {
    expect(CRON_SUBREQUEST_BUDGET).toBeLessThan(10_000)
    expect(CRON_TIME_BUDGET_MS).toBeLessThan(15 * 60 * 1000)
  })
})

describe('createBudgetSlice', () => {
  it('draws from the parent and refuses past its own cap without exhausting the parent', () => {
    const parent = createRunBudget({ maxUnits: 100, maxDurationMs: 1_000, now: clock().now })
    const slice = createBudgetSlice(parent, 30)
    expect(slice.take(20)).toBe(true)
    expect(parent.remaining).toBe(80)
    expect(slice.remaining).toBe(10)
    expect(slice.take(15)).toBe(false)
    expect(slice.exhausted).toBe(true)
    // Sticky for the slice only.
    expect(slice.take(1)).toBe(false)
    expect(parent.exhausted).toBe(false)
    expect(parent.take(70)).toBe(true)
  })

  it('refuses once the parent runs out of units or time', () => {
    const time = clock()
    const units = createRunBudget({ maxUnits: 10, maxDurationMs: 1_000, now: time.now })
    const wide = createBudgetSlice(units, 1_000)
    expect(wide.take(8)).toBe(true)
    expect(wide.take(5)).toBe(false)
    expect(units.exhausted).toBe(true)
    expect(createBudgetSlice(units, 1_000).take(1)).toBe(false)

    const timed = createRunBudget({ maxUnits: 100, maxDurationMs: 500, now: time.now })
    const slice = createBudgetSlice(timed, 50)
    expect(slice.take(1)).toBe(true)
    time.advance(500)
    expect(slice.take(1)).toBe(false)
    expect(timed.exhausted).toBe(true)
    expect(slice.remaining).toBe(0)
  })
})
