import { describe, expect, it } from 'vitest'
import { buildRecapSourceSnapshot, recapSourcesAreCurrent } from './recap-sources'

const rows = [
  {
    id: 'b',
    display_name: 'slides.pptx',
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' as const,
    byte_size: 200,
    sha256: 'b'.repeat(64),
  },
  {
    id: 'a',
    display_name: 'handout.pdf',
    mime_type: 'application/pdf' as const,
    byte_size: 100,
    sha256: 'a'.repeat(64),
  },
]

describe('audio recap source snapshot', () => {
  it('is stable across database ordering and totals source bytes', () => {
    const first = buildRecapSourceSnapshot(rows)
    const second = buildRecapSourceSnapshot([...rows].reverse())
    expect(first).toEqual(second)
    expect(first.documents.map((document) => document.id)).toEqual(['a', 'b'])
    expect(first.totalBytes).toBe(300)
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('requires verified hashes and treats legacy/no-document recaps as stale', () => {
    expect(() => buildRecapSourceSnapshot([{ ...rows[0], sha256: null }])).toThrow(
      'no verified integrity hash'
    )
    const snapshot = buildRecapSourceSnapshot(rows)
    expect(recapSourcesAreCurrent(snapshot.digest, snapshot)).toBe(true)
    expect(recapSourcesAreCurrent(null, snapshot)).toBe(false)
    expect(recapSourcesAreCurrent(snapshot.digest, buildRecapSourceSnapshot([]))).toBe(false)
  })
})
