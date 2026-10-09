/**
 * Chunking for the CSS typewriter (components/Typewriter.tsx, spec/13
 * "Homepage motion"). Each chunk becomes a nowrap inline-block whose text is
 * revealed one monospace advance per step, so layout is final from the first
 * paint and chunks wrap whole on narrow screens.
 */

export interface TypingChunk {
  text: string
  /** Characters before this chunk in the original string, joining spaces included. */
  offset: number
}

/**
 * 21 characters is what fits the tagline at 18px Plex Mono inside the 320px
 * hero (246px / 10.8px = 22.7ch), leaving 1ch for the block cursor.
 */
export const TYPEWRITER_MAX_CHUNK = 21

/**
 * Splits `text` at single spaces into the fewest contiguous chunks that each
 * fit in `maxChunk` characters, balancing them so the longest is as short as
 * possible (ties go to the earlier break). Returns null when the text is
 * empty or a single word is longer than `maxChunk`; callers then render the
 * text statically.
 */
export function chunkForTyping(text: string, maxChunk = TYPEWRITER_MAX_CHUNK): TypingChunk[] | null {
  if (text.length === 0 || !(maxChunk >= 1)) return null
  const words = text.split(' ')
  if (words.some((word) => word.length > maxChunk)) return null

  const starts: number[] = []
  let cursor = 0
  for (const word of words) {
    starts.push(cursor)
    cursor += word.length + 1
  }
  const span = (from: number, to: number) => starts[to - 1] + words[to - 1].length - starts[from]

  for (let groups = 1; groups <= words.length; groups++) {
    const breaks = balancedBreaks(words.length, groups, span)
    const bounds = [0, ...breaks, words.length]
    const lengths = bounds.slice(1).map((end, index) => span(bounds[index], end))
    if (Math.max(...lengths) > maxChunk) continue
    return bounds.slice(1).map((end, index) => {
      const offset = starts[bounds[index]]
      return { text: text.slice(offset, offset + lengths[index]), offset }
    })
  }
  return null
}

/** Word indexes where groups 2..k begin, minimising the longest group. */
function balancedBreaks(
  wordCount: number,
  groups: number,
  span: (from: number, to: number) => number
): number[] {
  const memo = new Map<string, number>()
  const best = (from: number, remaining: number): number => {
    if (remaining === 1) return span(from, wordCount)
    const key = `${from}:${remaining}`
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    let result = Infinity
    for (let end = from + 1; end <= wordCount - remaining + 1; end++) {
      result = Math.min(result, Math.max(span(from, end), best(end, remaining - 1)))
    }
    memo.set(key, result)
    return result
  }

  const breaks: number[] = []
  let from = 0
  for (let remaining = groups; remaining > 1; remaining--) {
    const target = best(from, remaining)
    let end = from + 1
    while (Math.max(span(from, end), best(end, remaining - 1)) !== target) end++
    breaks.push(end)
    from = end
  }
  return breaks
}
