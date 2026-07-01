import { describe, expect, it } from 'vitest'
import type { SlideBlock } from '@/lib/types'
import { alignBlocks, distributeBlocks } from './arrange'

function block(id: string, x: number, y: number, w: number, h: number): SlideBlock {
  return { id, type: 'text', x, y, w, h, z: 1, content: '' } as SlideBlock
}

describe('alignBlocks', () => {
  const a = block('a', 100, 100, 200, 50)
  const b = block('b', 400, 300, 100, 100)

  it('does nothing with fewer than two blocks', () => {
    expect(alignBlocks([a], 'left')).toEqual({})
  })

  it('aligns lefts to the bounding-box left', () => {
    expect(alignBlocks([a, b], 'left')).toEqual({
      a: { x: 100 },
      b: { x: 100 },
    })
  })

  it('aligns rights to the bounding-box right', () => {
    // Right edge of the group: max(100+200, 400+100) = 500
    expect(alignBlocks([a, b], 'right')).toEqual({
      a: { x: 300 },
      b: { x: 400 },
    })
  })

  it('centres horizontally on the group centre', () => {
    // Group spans x 100..500, centre 300
    expect(alignBlocks([a, b], 'centerH')).toEqual({
      a: { x: 200 },
      b: { x: 250 },
    })
  })

  it('aligns tops and bottoms', () => {
    expect(alignBlocks([a, b], 'top')).toEqual({ a: { y: 100 }, b: { y: 100 } })
    // Bottom edge: max(100+50, 300+100) = 400
    expect(alignBlocks([a, b], 'bottom')).toEqual({ a: { y: 350 }, b: { y: 300 } })
  })
})

describe('distributeBlocks', () => {
  it('does nothing with fewer than three blocks', () => {
    expect(
      distributeBlocks([block('a', 0, 0, 10, 10), block('b', 50, 0, 10, 10)], 'h')
    ).toEqual({})
  })

  it('spaces centres evenly between the first and last block', () => {
    const blocks = [
      block('a', 0, 0, 20, 20), // centre x = 10
      block('b', 30, 0, 20, 20), // centre x = 40 → should move to 60
      block('c', 100, 0, 20, 20), // centre x = 110
    ]
    expect(distributeBlocks(blocks, 'h')).toEqual({
      a: { x: 0 },
      b: { x: 50 }, // centre 60 - w/2
      c: { x: 100 },
    })
  })

  it('distributes vertically too', () => {
    const blocks = [
      block('a', 0, 0, 20, 20), // centre y = 10
      block('b', 0, 90, 20, 20), // centre y = 100 → should move to 60
      block('c', 0, 100, 20, 20), // centre y = 110
    ]
    expect(distributeBlocks(blocks, 'v')).toEqual({
      a: { y: 0 },
      b: { y: 50 },
      c: { y: 100 },
    })
  })
})
