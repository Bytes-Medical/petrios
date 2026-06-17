import { SLIDE_STAGE_WIDTH as W, SLIDE_STAGE_HEIGHT as H } from '@/lib/slides'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface SnapGuide {
  axis: 'x' | 'y'
  pos: number
}

export interface SnapResult {
  x: number
  y: number
  guides: SnapGuide[]
}

/**
 * Snap a moving rect's edges/centre to other rects' edges/centres and the stage
 * centre/edges. Returns the adjusted x/y plus the guide lines to draw. Geometry
 * is in stage pixels.
 */
export function computeSnap(moving: Rect, others: Rect[], threshold = 8): SnapResult {
  const vTargets = [0, W / 2, W]
  const hTargets = [0, H / 2, H]
  for (const o of others) {
    vTargets.push(o.x, o.x + o.w / 2, o.x + o.w)
    hTargets.push(o.y, o.y + o.h / 2, o.y + o.h)
  }

  // moving edges: [left/top, centre, right/bottom]
  const mX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
  const mY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]

  let snapX = moving.x
  let guideX: number | null = null
  let bestDX = threshold + 1
  for (const edge of mX) {
    for (const t of vTargets) {
      const d = Math.abs(edge - t)
      if (d < bestDX) {
        bestDX = d
        guideX = t
        snapX = moving.x + (t - edge)
      }
    }
  }
  if (bestDX > threshold) {
    guideX = null
    snapX = moving.x
  }

  let snapY = moving.y
  let guideY: number | null = null
  let bestDY = threshold + 1
  for (const edge of mY) {
    for (const t of hTargets) {
      const d = Math.abs(edge - t)
      if (d < bestDY) {
        bestDY = d
        guideY = t
        snapY = moving.y + (t - edge)
      }
    }
  }
  if (bestDY > threshold) {
    guideY = null
    snapY = moving.y
  }

  const guides: SnapGuide[] = []
  if (guideX != null) guides.push({ axis: 'x', pos: guideX })
  if (guideY != null) guides.push({ axis: 'y', pos: guideY })
  return { x: snapX, y: snapY, guides }
}
