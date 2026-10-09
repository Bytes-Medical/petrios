/**
 * Promise.allSettled with at most `limit` tasks in flight. Results keep input
 * order. Use it where each task holds a lot of memory at once (a rendered PDF
 * plus its base64 attachment, for example), because a Workers isolate has
 * 128 MB shared by every concurrent request.
 */
export async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Concurrency limit must be a positive integer')
  }

  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
