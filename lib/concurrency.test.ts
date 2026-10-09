import { describe, expect, it } from 'vitest'
import { mapSettledWithConcurrency } from './concurrency'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('mapSettledWithConcurrency', () => {
  it('never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5, 6, 7], 2, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return n * 10
    })
    expect(peak).toBe(2)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([
      10, 20, 30, 40, 50, 60, 70,
    ])
  })

  it('keeps input order when tasks finish out of order', async () => {
    const first = deferred<string>()
    const pending = mapSettledWithConcurrency(['slow', 'fast'], 2, (item) =>
      item === 'slow' ? first.promise : Promise.resolve(item)
    )
    first.resolve('slow')
    const results = await pending
    expect(results).toEqual([
      { status: 'fulfilled', value: 'slow' },
      { status: 'fulfilled', value: 'fast' },
    ])
  })

  it('captures rejections, including synchronous throws, and keeps going', async () => {
    const error = new Error('render failed')
    const results = await mapSettledWithConcurrency([1, 2, 3], 1, (n) => {
      if (n === 1) throw error
      if (n === 2) return Promise.reject(error)
      return Promise.resolve(n)
    })
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: 3 },
    ])
  })

  it('starts the next item only when a slot frees up', async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]
    const started: number[] = []
    const pending = mapSettledWithConcurrency([0, 1, 2], 2, async (n) => {
      started.push(n)
      await gates[n].promise
      return n
    })
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[1].resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(started).toEqual([0, 1, 2])
    gates[0].resolve()
    gates[2].resolve()
    await pending
  })

  it('handles an empty list and a limit above the item count', async () => {
    expect(await mapSettledWithConcurrency([], 3, async () => 1)).toEqual([])
    expect(await mapSettledWithConcurrency(['a'], 5, async (x) => x)).toEqual([
      { status: 'fulfilled', value: 'a' },
    ])
  })

  it('rejects a limit that is not a positive integer', async () => {
    await expect(mapSettledWithConcurrency([1], 0, async (x) => x)).rejects.toThrow(RangeError)
    await expect(mapSettledWithConcurrency([1], 1.5, async (x) => x)).rejects.toThrow(RangeError)
  })
})
