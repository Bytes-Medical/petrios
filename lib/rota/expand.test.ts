import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { expandPersonDays } from './expand'

beforeEach(() => vi.stubEnv('APP_TIME_ZONE', 'Europe/London'))
afterEach(() => vi.unstubAllEnvs())

describe('expandPersonDays', () => {
  const templates = {
    a: [['08:00', '17:00', 'A']] as [string, string, 'A'][],
    w: [['00:00', '24:00', 'L']] as [string, string, 'L'][],
  }

  it('converts BST and GMT wall-clock times', () => {
    const [summer] = expandPersonDays('a', templates, { from: '2026-07-01' })
    expect(new Date(summer.startMs).toISOString()).toBe('2026-07-01T07:00:00.000Z')
    const [winter] = expandPersonDays('a', templates, { from: '2026-12-01' })
    expect(new Date(winter.startMs).toISOString()).toBe('2026-12-01T08:00:00.000Z')
  })

  it('handles the spring-forward and fall-back days', () => {
    const [spring] = expandPersonDays('w', templates, { from: '2026-03-29' })
    expect((spring.endMs - spring.startMs) / 3_600_000).toBe(23)
    const [autumn] = expandPersonDays('w', templates, { from: '2026-10-25' })
    expect((autumn.endMs - autumn.startMs) / 3_600_000).toBe(25)
  })

  it('maps 24:00 to the next day and skips unknown days', () => {
    const intervals = expandPersonDays('.w', templates, { from: '2026-12-01' })
    expect(intervals).toHaveLength(1)
    expect(new Date(intervals[0].startMs).toISOString()).toBe('2026-12-02T00:00:00.000Z')
    expect(new Date(intervals[0].endMs).toISOString()).toBe('2026-12-03T00:00:00.000Z')
  })
})
