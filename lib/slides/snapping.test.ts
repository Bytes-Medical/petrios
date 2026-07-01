import { describe, expect, it } from 'vitest'
import { computeSnap, type Rect } from './snapping'

// Stage is 1280x720 (lib/slides.ts)

describe('computeSnap', () => {
  it('leaves the rect alone when nothing is within the threshold', () => {
    const moving: Rect = { x: 200, y: 200, w: 50, h: 50 }
    const result = computeSnap(moving, [])
    expect(result.x).toBe(200)
    expect(result.y).toBe(200)
    expect(result.guides).toEqual([])
  })

  it('snaps the left edge to the stage left', () => {
    const moving: Rect = { x: 5, y: 200, w: 50, h: 50 }
    const result = computeSnap(moving, [])
    expect(result.x).toBe(0)
    expect(result.guides).toContainEqual({ axis: 'x', pos: 0 })
  })

  it('snaps the centre to the stage centre', () => {
    // Stage centre x = 640; rect centre at 637 (within default threshold 8)
    const moving: Rect = { x: 612, y: 300, w: 50, h: 50 }
    const result = computeSnap(moving, [])
    expect(result.x + 25).toBe(640)
    expect(result.guides).toContainEqual({ axis: 'x', pos: 640 })
  })

  it('snaps to another block edge', () => {
    const other: Rect = { x: 300, y: 100, w: 100, h: 40 }
    // Moving right edge at 296 → snaps to other's left edge at 300
    const moving: Rect = { x: 246, y: 500, w: 50, h: 50 }
    const result = computeSnap(moving, [other])
    expect(result.x).toBe(250)
    expect(result.guides).toContainEqual({ axis: 'x', pos: 300 })
  })

  it('snaps both axes independently', () => {
    const moving: Rect = { x: 3, y: 715, w: 50, h: 4 }
    const result = computeSnap(moving, [])
    expect(result.x).toBe(0)
    // Bottom edge 719 snaps to stage bottom 720
    expect(result.y).toBe(716)
    expect(result.guides).toHaveLength(2)
  })

  it('respects a custom threshold', () => {
    const moving: Rect = { x: 5, y: 200, w: 50, h: 50 }
    const result = computeSnap(moving, [], 2)
    expect(result.x).toBe(5)
    expect(result.guides.filter((g) => g.axis === 'x')).toEqual([])
  })
})
