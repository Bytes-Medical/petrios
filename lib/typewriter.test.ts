import { describe, expect, it } from 'vitest'
import { chunkForTyping, TYPEWRITER_MAX_CHUNK } from './typewriter'
import { SITE_TAGLINE } from './site'

function rebuild(text: string, chunks: { text: string; offset: number }[]): string {
  return chunks.reduce((out, chunk) => out.padEnd(chunk.offset, ' ') + chunk.text, '')
}

describe('chunkForTyping', () => {
  it('splits the tagline into two balanced chunks', () => {
    expect(SITE_TAGLINE).toBe('The operating system for clinical teaching')
    expect(chunkForTyping(SITE_TAGLINE)).toEqual([
      { text: 'The operating system', offset: 0 },
      { text: 'for clinical teaching', offset: 21 },
    ])
  })

  it('keeps text of 21 characters or fewer as one chunk', () => {
    expect(chunkForTyping('for clinical teaching')).toEqual([{ text: 'for clinical teaching', offset: 0 }])
    expect(chunkForTyping('Petrios')).toEqual([{ text: 'Petrios', offset: 0 }])
  })

  it('returns null when a word is longer than the chunk limit', () => {
    expect(chunkForTyping('Interprofessionalisation training')).toBeNull()
    expect(chunkForTyping('a'.repeat(TYPEWRITER_MAX_CHUNK + 1))).toBeNull()
    expect(chunkForTyping('abcdef', 5)).toBeNull()
  })

  it('returns null for empty text', () => {
    expect(chunkForTyping('')).toBeNull()
  })

  it('breaks ties at the earlier position', () => {
    expect(chunkForTyping('aa bb cc', 5)).toEqual([
      { text: 'aa', offset: 0 },
      { text: 'bb cc', offset: 3 },
    ])
  })

  it.each([
    SITE_TAGLINE,
    'Evidence-based attendance for every session you teach, everywhere',
    'one two three four five six seven eight nine ten eleven twelve',
    'a  b   double spaced text that still reconstructs exactly',
    'x',
  ])('reconstructs %j from offsets and never exceeds the limit', (text) => {
    const chunks = chunkForTyping(text)
    expect(chunks).not.toBeNull()
    expect(rebuild(text, chunks!)).toBe(text)
    for (const chunk of chunks!) {
      expect(chunk.text.length).toBeLessThanOrEqual(TYPEWRITER_MAX_CHUNK)
      expect(text.slice(chunk.offset, chunk.offset + chunk.text.length)).toBe(chunk.text)
    }
  })

  it('uses the fewest chunks that fit', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve'
    const chunks = chunkForTyping(text)!
    const words = text.split(' ')
    const fitsIn = (groups: number, from = 0): boolean => {
      if (groups === 1) return words.slice(from).join(' ').length <= TYPEWRITER_MAX_CHUNK
      for (let end = from + 1; end <= words.length - groups + 1; end++) {
        if (words.slice(from, end).join(' ').length <= TYPEWRITER_MAX_CHUNK && fitsIn(groups - 1, end)) return true
      }
      return false
    }
    expect(fitsIn(chunks.length)).toBe(true)
    expect(fitsIn(chunks.length - 1)).toBe(false)
  })
})
