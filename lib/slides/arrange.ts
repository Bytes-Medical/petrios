import type { SlideBlock } from '@/lib/types'

export type AlignEdge = 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom'

type Patches = Record<string, { x?: number; y?: number }>

/** Align selected blocks to each other (to their common bounding box). */
export function alignBlocks(blocks: SlideBlock[], edge: AlignEdge): Patches {
  if (blocks.length < 2) return {}
  const minL = Math.min(...blocks.map((b) => b.x))
  const maxR = Math.max(...blocks.map((b) => b.x + b.w))
  const minT = Math.min(...blocks.map((b) => b.y))
  const maxB = Math.max(...blocks.map((b) => b.y + b.h))
  const cx = (minL + maxR) / 2
  const cy = (minT + maxB) / 2

  const out: Patches = {}
  for (const b of blocks) {
    switch (edge) {
      case 'left':
        out[b.id] = { x: Math.round(minL) }
        break
      case 'right':
        out[b.id] = { x: Math.round(maxR - b.w) }
        break
      case 'centerH':
        out[b.id] = { x: Math.round(cx - b.w / 2) }
        break
      case 'top':
        out[b.id] = { y: Math.round(minT) }
        break
      case 'bottom':
        out[b.id] = { y: Math.round(maxB - b.h) }
        break
      case 'middle':
        out[b.id] = { y: Math.round(cy - b.h / 2) }
        break
    }
  }
  return out
}

/** Distribute centres evenly between the first and last block on an axis. */
export function distributeBlocks(blocks: SlideBlock[], axis: 'h' | 'v'): Patches {
  if (blocks.length < 3) return {}
  const center = (b: SlideBlock) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2)
  const sorted = [...blocks].sort((a, b) => center(a) - center(b))
  const first = center(sorted[0])
  const last = center(sorted[sorted.length - 1])
  const step = (last - first) / (sorted.length - 1)

  const out: Patches = {}
  sorted.forEach((b, i) => {
    const c = first + step * i
    out[b.id] = axis === 'h' ? { x: Math.round(c - b.w / 2) } : { y: Math.round(c - b.h / 2) }
  })
  return out
}
