import { describe, expect, it } from 'vitest'
import {
  normalizeTeachingCoordinatorNames,
  resolveTeachingCoordinatorNames,
  validateTeachingCoordinatorNames,
} from './coordinators'

describe('teaching coordinator names', () => {
  it('trims, collapses whitespace, preserves order, and removes duplicates', () => {
    expect(
      normalizeTeachingCoordinatorNames([
        '  Dr Jane   Smith ',
        'Professor Sam Lee',
        'dr jane smith',
        '',
        null,
      ])
    ).toEqual(['Dr Jane Smith', 'Professor Sam Lee'])
  })

  it('falls back to the historical teaching lead', () => {
    expect(resolveTeachingCoordinatorNames([], ' Dr Legacy Lead ')).toEqual([
      'Dr Legacy Lead',
    ])
  })

  it('rejects too many names and overlong names at the action boundary', () => {
    expect(() => validateTeachingCoordinatorNames(['A', 'B', 'C', 'D', 'E'])).toThrow(
      'no more than 4'
    )
    expect(() => validateTeachingCoordinatorNames(['A'.repeat(81)])).toThrow(
      'limited to 80'
    )
  })
})
