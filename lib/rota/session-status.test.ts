import { describe, expect, it } from 'vitest'
import { classifySessionOverlap } from './session-status'
import type { RotaLetter } from './types'

const T0 = Date.UTC(2026, 9, 12, 12, 0)
const min = (n: number) => T0 + n * 60_000
const iv = (from: number, to: number, letter: RotaLetter) => ({ startMs: min(from), endMs: min(to), letter })

describe('classifySessionOverlap', () => {
  it('is unavailable at exactly 30 unavailable minutes of a long session', () => {
    expect(classifySessionOverlap([iv(0, 30, 'D'), iv(30, 120, 'A')], { startMs: min(0), endMs: min(120) })).toBe('UNAVAILABLE')
    expect(classifySessionOverlap([iv(0, 29, 'D'), iv(29, 120, 'A')], { startMs: min(0), endMs: min(120) })).toBe('AVAILABLE')
  })

  it('uses 50% for a short session', () => {
    // 45-minute session: threshold min(30, 22.5) = 22.5
    expect(classifySessionOverlap([iv(0, 22.5, 'N')], { startMs: min(0), endMs: min(45) })).toBe('UNAVAILABLE')
    expect(classifySessionOverlap([iv(0, 22, 'N')], { startMs: min(0), endMs: min(45) })).toBe('UNKNOWN')
  })

  it('treats uncovered minutes as unknown, not unavailable', () => {
    // Day shift 08:30-17:00 (as minutes 30..540 here); session 08:00-09:00 starts before it.
    expect(classifySessionOverlap([iv(30, 540, 'A')], { startMs: min(0), endMs: min(60) })).toBe('AVAILABLE')
    // Session 17:00-18:00 after the shift: nothing covered.
    expect(classifySessionOverlap([iv(30, 540, 'A')], { startMs: min(540), endMs: min(600) })).toBe('UNKNOWN')
  })

  it('is available when all A', () => {
    expect(classifySessionOverlap([iv(-60, 600, 'A')], { startMs: min(0), endMs: min(60) })).toBe('AVAILABLE')
  })

  it('counts leave and not-working as unavailable', () => {
    expect(classifySessionOverlap([iv(-600, 600, 'L')], { startMs: min(0), endMs: min(60) })).toBe('UNAVAILABLE')
    expect(classifySessionOverlap([iv(-600, 600, 'X')], { startMs: min(0), endMs: min(60) })).toBe('UNAVAILABLE')
  })

  it('returns unknown for an empty session', () => {
    expect(classifySessionOverlap([iv(0, 60, 'D')], { startMs: min(0), endMs: min(0) })).toBe('UNKNOWN')
  })
})
