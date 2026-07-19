import { describe, expect, it } from 'vitest'
import {
  audioRecapScriptDigest,
  estimateAudioDurationSeconds,
  mp3DurationSeconds,
} from './audio-recap-provenance'

function mpeg1Layer3Frame(): Buffer {
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz, no padding: 417-byte frame.
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  return frame
}

describe('audio recap provenance', () => {
  it('normalizes surrounding whitespace before hashing a script', () => {
    expect(audioRecapScriptDigest('  hello world\n')).toBe(
      audioRecapScriptDigest('hello world')
    )
  })

  it('keeps the narration estimate bounded', () => {
    expect(estimateAudioDurationSeconds('one two three')).toBe(15)
    expect(estimateAudioDurationSeconds('word '.repeat(10_000))).toBe(1800)
  })

  it('derives duration from contiguous MP3 frames', () => {
    const audio = Buffer.concat(Array.from({ length: 100 }, mpeg1Layer3Frame))
    expect(mp3DurationSeconds(audio)).toBe(3)
  })

  it('rejects data that is not a usable MP3 stream', () => {
    expect(mp3DurationSeconds(Buffer.from('not audio'))).toBeNull()
  })
})
